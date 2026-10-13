/**
 * Manifest rel -> path on disk decisions — the small set of rules that turn an `owned` list
 * entry (a POSIX-spelled relative path, read straight off a `.geneseed-manifest.json` that
 * sits inside the install) into something safe to act on.
 *
 * `ownedWithin` is the first tenant: both `uninstall.mjs`'s owned-file walk and the generator
 * driver's prune read a manifest's `owned` list and must agree on the one security boundary
 * neither may skip — a manifest is a file on disk, and per-repo ones live inside the very repo
 * a build runs over, so a cloned repo's manifest is as untrusted as any other file it ships.
 *
 * `safeLeaf` is the second: `ownedWithin` only proves a REL resolves inside the root, which
 * says nothing about what sits at that path. A per-repo manifest can ship a rel that resolves
 * inside the root AND is itself a symlink or a hard link out — `claimer` runs `safeLeaf` on
 * every destination before it ever claims one.
 *
 * `claimLeaf` is `safeLeaf` plus the one sentence every refusal must print, because `claimer`
 * is not the only writer whose path lands in `owned`: `writeVersion`, `shipLeanLaws`, and a
 * handful of direct `writeText` calls in `emit-claude.mjs`/`emit-opencode.mjs` (the Bob rules
 * stub, the project `.gitignore`, the OpenCode-global `AGENT.md`) push a rel into `owned`
 * too, and the spec's intent — never write through a linked owned file — covers all of them,
 * not just the ones that happen to go through a `claim()` closure.
 */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { resolvePath } from './hosts.mjs';
import { within } from '../lib/paths.mjs';
import { isFile } from '../lib/fs.mjs';

/**
 * The manifest rels that resolve INSIDE `base` — the one security boundary every walk over
 * `owned` goes through (uninstall, both deactivates, build prune (`pruneOwned` in js/build/driver.mjs)).
 *
 * `path.resolve(rroot, r)` and NOT `path.join`, which is the one line here that is a security
 * boundary rather than a translation. The Python is `(rroot / r).resolve()`, and pathlib's
 * `/` REPLACES the base when the right operand is absolute — so a manifest entry naming
 * `C:/evil.md` resolves outside the root and `_within` rejects it. `path.join` would have
 * concatenated it into `<root>/C:/evil.md`, which passes containment and would then be acted
 * on. `path.resolve` has pathlib's semantics for exactly this case, and collapses `..`
 * besides, which is why the guard runs on the resolved path rather than the lexical one.
 */
export function ownedWithin(base, rels) {
  const rroot = resolvePath(base);
  return rels.filter((r) => r && within(resolvePath(path.resolve(rroot, r)), rroot));
}

/**
 * True when `dest` is safe for `claimer` to (over)write: not itself a link, not a second name
 * for a file with other names, and — once symlinks on its existing ancestor resolve — still
 * inside `root`. False for the shape the leaf guard exists to catch: a cloned repo's manifest
 * naming a rel that resolves inside the config root (so `ownedWithin` lets it through) at a
 * path that is ITSELF a symlink or hard link pointing somewhere else, such as
 * `.opencode/skills/x/SKILL.md` symlinked to `~/.bashrc` with a manifest entry claiming it.
 *
 * `lstatSync(dest, { throwIfNoEntry: false })`, never `existsSync` first — a DANGLING symlink
 * (the attack's own shape: the real target need not exist yet for the write to land on it the
 * moment something else creates it there) reads as ABSENT to `existsSync` and as a symlink to
 * `lstat`, so `existsSync` is exactly the check that misses this case.
 *
 * `nlink` is checked only for a regular file. A directory's `nlink` is routinely > 1 — every
 * child subdirectory's own `..` entry adds one — so gating on `isFile()` is what keeps an
 * ordinary nested skill folder from tripping the hard-link branch on its own directories.
 *
 * A symlinked ROOT — `~/.claude` as a dotfiles repo's own symlink, or a `CLAUDE_CONFIG_DIR`
 * env override pointing at one (`js/hosts/link.mjs` links the `geneseed` CLI binary onto
 * PATH, a different concern entirely, and never a config root) — is NOT this shape:
 * `resolvePath` follows the root link on both `root` and `dest`, so a leaf reached the
 * ordinary way through a linked root still resolves inside it and stays allowed — only the
 * LEAF itself being a link is refused.
 */
export function safeLeaf(root, dest) {
  const rroot = resolvePath(root);
  const st = lstatSync(dest, { throwIfNoEntry: false });
  if (st) {
    if (st.isSymbolicLink()) return false;
    if (st.isFile() && st.nlink > 1) return false;
  }
  return within(resolvePath(dest), rroot);
}

/**
 * `safeLeaf(root, dest)`, and on false the warning line every refusal prints — ONE sentence,
 * so `claimer` and every direct owned-path writer below it say the same thing rather than
 * each inventing its own wording. `rel` is the manifest spelling (POSIX, root-relative);
 * callers that already have it (every one of them, since it is what they are about to push
 * into `owned`) pass it straight through instead of re-deriving it from `dest`.
 */
export function claimLeaf(root, dest, rel) {
  if (safeLeaf(root, dest)) return true;
  process.stderr.write(`[geneseed] refused ${rel}: it is a link — Geneseed writes only `
    + 'regular files it owns\n');
  return false;
}

/**
 * sha256 hex of the bytes on disk at `p`, with every `\r\n` folded to `\n` first. The fold is
 * the point: a committed install is checked out by git with whatever line endings that clone's
 * `core.autocrlf` / `.gitattributes` / OS asks for, and a teammate on the other OS gets every
 * owned file's endings flipped without touching a byte of content. Hashed raw, that read as an
 * edit to every file and the next rebuild froze the harness (measured: 95 false "kept your
 * edited", owned 106 -> 11). A lone `\r` is not folded — git never writes one, so it is content.
 * `latin1` maps each byte to one char and back, so the fold is byte-exact on any file, text or not.
 */
export function fileHash(p) {
  const folded = readFileSync(p).toString('latin1').replaceAll('\r\n', '\n');
  return createHash('sha256').update(folded, 'latin1').digest('hex');
}

/**
 * One sha256 per entry of `owned` that is both inside `root` (through `ownedWithin`, the same
 * containment boundary every other owned-rel walk goes through) and a file that still exists —
 * a rel a prune is about to delete, or one a crafted manifest named outside root, is skipped
 * rather than hashed. Keys land in the same sorted order the manifest writers already give
 * `owned` itself (`[...owned].sort()`), so the hash map a re-emit produces for an unchanged
 * tree is byte-identical to the one before it — `golden.mjs --idempotent`'s whole point.
 */
export function ownedHashes(root, owned) {
  const hashes = {};
  for (const rel of ownedWithin(root, owned).sort()) {
    const p = path.join(root, rel);
    if (isFile(p)) hashes[rel] = fileHash(p);
  }
  return hashes;
}

/** `/^[0-9a-f]{64}$/` — the only shape a hash this module wrote ever takes. */
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * `doc.hashes` read back defensively: a manifest is a file on disk, as untrusted as any other
 * (`ownedWithin`'s own docblock), so a hand-edited or corrupt `hashes` must read as "nothing
 * recorded" rather than crash or poison a comparison with a value that was never really a
 * sha256. ANY malformed entry zeroes the whole map rather than only dropping that one key —
 * a map that is wrong in one place is not trustworthy in the rest either.
 */
export function hashesOf(doc) {
  const h = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc.hashes : undefined;
  if (!h || typeof h !== 'object' || Array.isArray(h)) return {};
  for (const v of Object.values(h)) {
    if (typeof v !== 'string' || !HEX64.test(v)) return {};
  }
  return { ...h };
}

/**
 * Where one owned file stands against its recorded hash — the table later tasks (rebuild,
 * prune, uninstall) will branch on to stop clobbering a user's edit to a Geneseed-owned file.
 * `'unknown'` is deliberately distinct from `'unmodified'`: an older manifest with no `hashes`
 * entry for this rel (today's installs, pre-Task-3) must not be read as "proven untouched" —
 * see the constraint that a manifest without `hashes` keeps today's behaviour exactly.
 */
export function ownedState(root, rel, hashes) {
  if (!Object.hasOwn(hashes, rel)) return 'unknown';
  const expected = hashes[rel];
  const p = path.join(root, rel);
  if (!isFile(p)) return 'missing';
  return fileHash(p) === expected ? 'unmodified' : 'modified';
}
