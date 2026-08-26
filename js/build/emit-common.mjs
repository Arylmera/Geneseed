/**
 * What every emit shares — the constants that name what this tool owns, the small readers it
 * walks a tree with, and the three writers both GLOBAL emits call.
 *
 * Split out of `emit.mjs` because each of `globalMemory`, `globalNotebook`, `shipLeanLaws`
 * and `stripCapabilityLinks` has two callers in two different host emits. A helper with two
 * hosts belongs to neither, and putting it in one of them is how a file grows to 1400 lines.
 *
 * Nothing here decides WHICH host is being emitted. `emit-opencode.mjs` and
 * `emit-claude.mjs` do that; `emit.mjs` renders the bundle they read from.
 */
import path from 'node:path';
import { copyFile, writeText } from '../lib/fs.mjs';
import { SRC_DIR_TOKENS, destRel } from './render.mjs';
import { mkdirSync, readdirSync, statSync } from 'node:fs';

/** `_build_render.SRC_DIRS_MARKER`. */
export const SRC_DIRS_MARKER = '.geneseed-srcdirs.json';
/**
 * `_build_render.OWNED_SRC_DIRS` — wiped and regenerated each run.
 *
 * `ontology` and `doctrines` are appended, not inserted: this array's iteration order is the
 * key order of the `.geneseed-srcdirs.json` marker it fills, and appending keeps the three
 * original keys where an existing install's marker already has them.
 *
 * They belong here for the same reason `laws` does — they are GENERATED, so an install must
 * not keep a copy the source no longer produces. Without them a build writes the dirs on
 * every run and never wipes them, which turns the doctrines toggle into a one-way switch:
 * disable a pack, rebuild, and its rendered file sits in the install forever, contradicting
 * the `Active packs:` line in the AGENT.md right beside it.
 */
export const OWNED_SRC_DIRS = ['laws', 'agents', 'skills', 'ontology', 'doctrines'];

/**
 * The constitution dirs a LEAN emit re-ships in full text — see `shipLeanLaws`.
 *
 * Not all of `OWNED_SRC_DIRS`: `agents` and `skills` are already written as whole files by
 * the native layer, and only the three constitution dirs are inlined into AGENT.md in a
 * form (terse, or pack-filtered) that loses text the reader may still need.
 */
const LEAN_FULL_TEXT_DIRS = ['laws', 'ontology', 'doctrines'];

/**
 * `_build_core.CAPABILITY_LINK_RE`.
 *
 * NOT OVERRIDABLE. Python's `cfg.capabilityLinkRe` was the driver's seam for tests that
 * monkeypatch `_build_core.CAPABILITY_LINK_RE`; `bin/build-driver.mjs` deliberately never
 * sends one (see its docblock), so the override branch that used to sit in
 * `stripCapabilityLinks` never took its left-hand side and was deleted as dead code in the
 * over-engineering cleanup. `tests/unit/harness.test.mjs`'s planted-fault test drives this
 * exact constant by rewriting the module's source text instead, which is what "no injection
 * point left" means there.
 */
const CAPABILITY_LINK_RE =
  /\[([^\]]+)\]\((?:(?!https?:\/\/|\/)[A-Za-z0-9_.-]+\/)*(?:agents|skills)\/[A-Za-z0-9_-]+\.md\)/g;

/** `_build_render._TMPL_SPEC_RE`. */
export const TMPL_SPEC_RE = /\{\{DIR_(AGENTS|SKILLS)\}\}\/([A-Za-z0-9_-]+)\.md/g;

// ---------------------------------------------------------------------------
// Small filesystem predicates. Python spells these `Path.is_file()` / `is_dir()`, both
// of which answer False for a missing path rather than raising; `statSync` throws.
// ---------------------------------------------------------------------------

export function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

export function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

/** `dict.get(key)` with Python's semantics — OWN properties only.
 *
 * The same hazard `js/hosts/settings.mjs` and `js/hosts/native.mjs` both spell out: the keys here come
 * out of a manifest the user can edit, and `old['constructor']` hands back
 * `Object.prototype`'s member where Python's `.get` returns None. */
export function get(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

export function isDict(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/** `Path.rglob("*")` restricted to files, skipping `__pycache__` as Python's callers do. */
export function rglobFiles(root, out = []) {
  for (const name of readdirSync(root)) {
    if (name === '__pycache__') continue;
    const full = path.join(root, name);
    if (isDir(full)) rglobFiles(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * `Path.rglob("*")` restricted to files, keeping EVERYTHING — including `__pycache__`.
 *
 * Not a duplicate of `rglobFiles` by accident: `source_fingerprint`'s Python filters
 * `__pycache__` and the legacy-store migration in `_global_memory` does not, so a single
 * walk would be wrong for one caller either way. A user's legacy bundle really can carry
 * one (the harness ships `.py` skill scripts), and copying it or not is a byte difference
 * the two runtimes would disagree on silently.
 */
function rglobAllFiles(root, out = []) {
  for (const name of readdirSync(root)) {
    const full = path.join(root, name);
    if (isDir(full)) rglobAllFiles(full, out);
    else out.push(full);
  }
  return out;
}

/** `p.relative_to(base).as_posix()`. */
export function relPosix(base, p) {
  return path.relative(base, p).split(path.sep).join('/');
}

/**
 * `_build_emit._strip_capability_links` — `re.sub(r"\1")`, so the pattern needs `g`.
 *
 * Exported for `js/inspect/checks-build.mjs`: `_rendered_problems` applies the same de-linking before
 * comparing an OpenCode bundle's AGENT.md against a fresh render, because the emit puts
 * that difference back by design and a check that did not would report the file stale on
 * every run forever.
 */
export function stripCapabilityLinks(text) {
  return text.replace(CAPABILITY_LINK_RE, '$1');
}

// ---------------------------------------------------------------------------
// The global-store helpers, shared by the `opencode-global` and `claude` jobs
// ---------------------------------------------------------------------------

/**
 * `_build_global._global_memory` — ensure `<cfg>/memory` exists, without ever touching a
 * store that already holds something.
 *
 * The three outcomes are the returned status string, which the emit prints, so they are
 * compared through stdout as well as through the tree. Python's `theme` parameter is
 * dropped: the store dir is ALWAYS the classic English `memory/`, never themed (the
 * OpenCode config dir uses fixed names), so the argument was never read.
 *
 * The migration branch copies arbitrary USER files out of a legacy bundle, which is the
 * reason this is not a plain translation: everything it touches is the user's, and the
 * only thing keeping it safe is that it runs at all only when the destination is empty.
 */
export function globalMemory(cfgDir, items, legacy, srcRoot) {
  const memName = 'memory';
  const memDir = path.join(cfgDir, memName);
  if (isDir(memDir) && readdirSync(memDir).length) return `kept ${memName}/`;
  mkdirSync(memDir, { recursive: true });
  if (legacy) {
    // `dict.fromkeys([mem_name, "memory", "anamnesis"])` — de-duplicated, order kept.
    // `mem_name` is the literal 'memory' and the Python docstring beside it says the
    // store name is NEVER themed, so the first two entries always collapse and
    // `anamnesis` — an older themed install's name — is the only live alias. The dedupe
    // is what keeps the duplicate harmless rather than copying the same dir twice.
    for (const nm of [...new Set([memName, 'memory', 'anamnesis'])]) {
      const src = path.join(legacy, nm);
      if (isDir(src) && readdirSync(src).length) {
        for (const f of rglobAllFiles(src)) {
          const dest = path.join(memDir, path.relative(src, f));
          mkdirSync(path.dirname(dest), { recursive: true });
          copyFile(f, dest);
        }
        return `migrated ${nm}/ -> ${memName}/`;
      }
    }
  }
  for (const { text, src } of items) {
    const sp = relPosix(srcRoot, src).split('/');
    if (sp[0] === 'memory' && sp.length > 1) {
      // `destRel`, because this seeds from the SOURCE path and not from the item's `rel`
      // (which is themed, and `memory/` never is). Without it the store would be seeded
      // with the on-disk name `gitignore` — see `js/build/render.mjs`'s `destRel`.
      const dest = path.join(memDir, destRel(path.join(...sp.slice(1))));
      mkdirSync(path.dirname(dest), { recursive: true });
      if (text !== null) writeText(dest, text);
      else copyFile(src, dest);
    }
  }
  return `seeded ${memName}/`;
}

/** `_build_global._global_notebook` — the same shape, with no `anamnesis` alias. */
export function globalNotebook(cfgDir, items, legacy, srcRoot) {
  const nbName = 'notebook';
  const nbDir = path.join(cfgDir, nbName);
  if (isDir(nbDir) && readdirSync(nbDir).length) return `kept ${nbName}/`;
  mkdirSync(nbDir, { recursive: true });
  if (legacy) {
    const src = path.join(legacy, nbName);
    if (isDir(src) && readdirSync(src).length) {
      for (const f of rglobAllFiles(src)) {
        const dest = path.join(nbDir, path.relative(src, f));
        mkdirSync(path.dirname(dest), { recursive: true });
        copyFile(f, dest);
      }
      return `migrated ${nbName}/`;
    }
  }
  for (const { text, src } of items) {
    const sp = relPosix(srcRoot, src).split('/');
    if (sp[0] === nbName && sp.length > 1) {
      // `destRel` — same reason as `globalMemory` above.
      const dest = path.join(nbDir, destRel(path.join(...sp.slice(1))));
      mkdirSync(path.dirname(dest), { recursive: true });
      if (text !== null) writeText(dest, text);
      else copyFile(src, dest);
    }
  }
  return `seeded ${nbName}/`;
}

/**
 * `_build_global._ship_lean_laws`.
 *
 * Historically the one RENDER that ran AFTER a WIRE, which is why the phase-order
 * normalisation had to move it before the seam could be cut. Re-derived rather than
 * trusted: its inputs are `items` and `theme` (both from `render_all`) and its only
 * output besides the files is what it APPENDS to `owned` — which travels back in the
 * payload for the manifest and the prune. It reads nothing any wiring stage writes, so
 * its new position is not merely legal, it has no dependency on the old one.
 *
 * NO LONGER LEAN-ONLY, and the name is kept because the lean case is still the whole reason
 * it exists. `doctrines` ships at BOTH footprints, because the two footprints lose different
 * things: lean loses text (every rule is truncated to its first sentence, so the full text has
 * to be on disk), while FULL loses whole packs (only the active ones are inlined, so the
 * inactive ones have to be on disk). AGENT.md tells the agent it may read a rule in a pack
 * that is not active, and `src/doctrines/README.md` rests cross-pack citations on exactly
 * that — a claim the emit has to make true, not merely the `files` bundle.
 */
export function shipLeanLaws(items, theme, cfgDir, owned, footprint) {
  // Themed names, resolved through the same token table `build`'s wipe resolves, so the dir
  // a lean emit re-ships and the dir it prunes can never be two different spellings.
  const wanted = footprint === 'lean' ? LEAN_FULL_TEXT_DIRS : ['doctrines'];
  const dirs = new Set(wanted.map((d) => theme[SRC_DIR_TOKENS[d]] ?? d));
  for (const { rel, text } of items) {
    const parts = rel.split('/');
    // `parts.length` mirrors Python's `parts and parts[0]`, where `Path("").parts` really
    // is empty. `String.split` never returns an empty array, so this half can never be
    // false here — kept for the mirror, and its mutation stays green because there is
    // nothing to detect, not because the gate cannot see it.
    if (text !== null && parts.length && dirs.has(parts[0])) {
      const dest = path.join(cfgDir, ...parts);
      mkdirSync(path.dirname(dest), { recursive: true });
      writeText(dest, text);
      owned.push(rel);
    }
  }
}

