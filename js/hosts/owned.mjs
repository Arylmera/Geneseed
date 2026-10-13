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
 */
import { lstatSync } from 'node:fs';
import path from 'node:path';

import { resolvePath } from './hosts.mjs';
import { within } from '../lib/paths.mjs';

/**
 * The manifest rels that resolve INSIDE `base` — the one security boundary every walk over
 * `owned` goes through (uninstall, both deactivates).
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
 * A symlinked ROOT (`~/.claude` -> a dotfiles repo, a `CLAUDE_CONFIG_DIR` relocation, or a
 * link `js/hosts/link.mjs` made itself) is NOT this shape: `resolvePath` follows the root
 * link on both `root` and `dest`, so a leaf reached the ordinary way through a linked root
 * still resolves inside it and stays allowed — only the LEAF itself being a link is refused.
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
