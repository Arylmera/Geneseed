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
import { copyFile, writeText, isFile, isDir } from '../lib/fs.mjs';
import { get, isDict } from '../lib/json.mjs';
import { SRC_DIR_TOKENS, destRel } from './render.mjs';
import { mkdirSync, readdirSync, cpSync } from 'node:fs';

// `isFile`/`isDir`/`get`/`isDict` are owned by `js/lib` now (single owner across `hosts/`,
// `build/`, `inspect/` and `web/` — layering forbids `build/` reaching into `inspect/scan.mjs`
// for them, so `js/lib` is the one home both sides can reach). Re-exported here so this
// module's own existing callers (`emit-claude.mjs`, `emit-opencode.mjs`, `version.mjs`,
// `bundle.mjs`) keep importing them from `./emit-common.mjs` unchanged.
export { isFile, isDir, get, isDict };

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

/**
 * `Path.rglob("*")` restricted to files, skipping `__pycache__` as Python's callers do.
 *
 * `recursive: true, withFileTypes: true` (Node >= 20.1, `parentPath` >= 21.4 — this repo
 * requires >= 22.3) replaces a hand-rolled walk; the order it yields is NOT the walk's
 * order, but `sourceFingerprint`, this function's one caller, re-sorts every result by a
 * plain string key before it is ever observed, so no caller depends on it.
 */
export function rglobFiles(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && !d.parentPath.split(path.sep).includes('__pycache__'))
    .map((d) => path.join(d.parentPath, d.name));
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
 * `_build_global._global_memory`/`_global_notebook` — ensure `<cfg>/<name>` exists, without
 * ever touching a store that already holds something.
 *
 * The three outcomes are the returned status string, which the emit prints, so they are
 * compared through stdout as well as through the tree. Python's `theme` parameter is
 * dropped for both: the store dir is ALWAYS the classic English name, never themed (the
 * OpenCode config dir uses fixed names), so the argument was never read.
 *
 * THE MIGRATED MESSAGE'S SHAPE TRACKS THE ALIAS COUNT, not a caller-supplied format flag.
 * `memory` is the only store with more than one legacy name — `anamnesis`, an older themed
 * install's — so its status names which one matched: `migrated anamnesis/ -> memory/`.
 * `notebook` has exactly one candidate and its status has never named an arrow:
 * `migrated notebook/`. One alias is nothing a rename could be reporting, so the arrow is
 * dropped rather than printed as a no-op `notebook/ -> notebook/`.
 *
 * The migration branch copies arbitrary USER files out of a legacy bundle, which is the
 * reason this is not a plain translation: everything it touches is the user's, and the
 * only thing keeping it safe is that it runs at all only when the destination is empty.
 */
function globalStore(cfgDir, items, legacy, srcRoot, name, aliases = [name]) {
  const dir = path.join(cfgDir, name);
  if (isDir(dir) && readdirSync(dir).length) return `kept ${name}/`;
  mkdirSync(dir, { recursive: true });
  if (legacy) {
    // `dict.fromkeys(aliases)` — de-duplicated, order kept. The dedupe is what keeps a
    // caller that lists `name` itself among its aliases (as `memory` does) from copying
    // the same dir twice.
    for (const nm of [...new Set(aliases)]) {
      const src = path.join(legacy, nm);
      if (isDir(src) && readdirSync(src).length) {
        // `cpSync(..., {preserveTimestamps: true})` — the recursive-copy equivalent of
        // `copyFile` above (byte copy + carried mtime, no `shutil.copy2` mode bits; see
        // that function's docblock in `js/lib/fs.mjs`), replacing a walk-then-copyFile
        // loop that visited every legacy file one at a time.
        cpSync(src, dir, { recursive: true, preserveTimestamps: true });
        return aliases.length > 1 ? `migrated ${nm}/ -> ${name}/` : `migrated ${name}/`;
      }
    }
  }
  for (const { text, src } of items) {
    const sp = relPosix(srcRoot, src).split('/');
    if (sp[0] === name && sp.length > 1) {
      // `destRel`, because this seeds from the SOURCE path and not from the item's `rel`
      // (which is themed, and the store dir never is). Without it the store would be
      // seeded with the on-disk name `gitignore` — see `js/build/render.mjs`'s `destRel`.
      const dest = path.join(dir, destRel(path.join(...sp.slice(1))));
      mkdirSync(path.dirname(dest), { recursive: true });
      if (text !== null) writeText(dest, text);
      else copyFile(src, dest);
    }
  }
  return `seeded ${name}/`;
}

export function globalMemory(cfgDir, items, legacy, srcRoot) {
  return globalStore(cfgDir, items, legacy, srcRoot, 'memory', ['memory', 'anamnesis']);
}

/** `_build_global._global_notebook` — the same shape, with no `anamnesis` alias. */
export function globalNotebook(cfgDir, items, legacy, srcRoot) {
  return globalStore(cfgDir, items, legacy, srcRoot, 'notebook');
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

