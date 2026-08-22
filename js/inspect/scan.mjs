/**
 * `_harness_core`'s scanning primitives — what every doctor check reads the tree with.
 *
 * Split out of `doctor.mjs` because all three check modules need them and none of the three
 * owns them. Nothing here decides anything: these walk, sort, strip and test, and the
 * judgement lives in `checks-build.mjs`, `checks-repo.mjs` and `checks-authoring.mjs`.
 *
 * `NOTE` and `isDoctorNote` sit here for the same reason — a check in any of the three
 * marks an advisory line with the prefix, and the driver in `doctor.mjs` reads it back.
 */
import os from 'node:os';
import path from 'node:path';
import { SRC } from '../build/source.mjs';
import { comparePaths, normcase } from '../lib/paths.mjs';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';

// --------------------------------------------------------------------------------------
// _harness_core's scanning primitives
// --------------------------------------------------------------------------------------

/** `_harness_core.TOKEN_RE` / `LINK_RE` / `ABS_LINK_RE`. `g` where `findall` is used. */
// Must stay in step with `js/build/render.mjs`'s TOKEN_RE: a token the renderer substitutes but this
// scan cannot see is an unresolved-token gate that silently stops gating. Digits are legal after
// the first character for `DOC_<PACK>_<n>`; a leading digit is still not a token.
export const TOKEN_RE = /\{\{[A-Z_][A-Z0-9_]*\}\}/g;
export const LINK_RE = /\]\((?!https?:\/\/|#)([^)]+)\)/g;
export const ABS_LINK_RE = /^([A-Za-z]:[\\/]|\/|~)/;
const FENCE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`]*`/g;
const COMMENT_RE = /<!--[\s\S]*?-->/g;

/** `_harness_core.strip_code` — fenced blocks, inline code and HTML comments, in that order. */
export function stripCode(text) {
  return text.replace(FENCE_RE, '').replace(COMMENT_RE, '').replace(INLINE_CODE_RE, '');
}

/**
 * `_harness_core._within` — `child.relative_to(parent)` without the exception.
 *
 * Segment-wise and through `normcase`, because that is what `PurePath` comparison does: a
 * bundle at `C:\Temp\X` contains `c:\temp\x\a.md` on Windows and does not on Linux. A
 * `startsWith` on the raw strings would additionally call `/tmp/bundle2` a child of
 * `/tmp/bundle`, which is the classic version of this bug.
 */
export function within(child, parent) {
  const c = normcase(child).split(/[\\/]/);
  const p = normcase(parent).split(/[\\/]/);
  return p.length <= c.length && p.every((seg, i) => c[i] === seg);
}

export const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
export const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

/** `sorted(d.glob(pat))`, or `[]` for a directory that is not there. */
export function globSorted(dir, filter) {
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter(filter).map((n) => path.join(dir, n)).sort(comparePaths);
}

/** `Path.rglob('*')` — every entry under `dir`, sorted as `sorted()` sorts paths. */
export function rglob(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries.map((x) => x.name).sort(comparePaths)) {
      const p = path.join(d, e);
      out.push(p);
      if (isDir(p)) walk(p);
    }
  };
  walk(dir);
  return out.sort(comparePaths);
}

// `withDiscardableStderr` was defined here while `renderedProblems` was its only caller.
// `js/hosts/hooks.mjs` became the second and third when the hook started CATCHING `expanduser`'s
// refusal, so it moved beside `printErr` in `js/lib/fs.mjs` — the writes it intercepts —
// and its docblock carries the "not for silencing noise" warning with it.

/** `Path.stem` — the basename with its last suffix removed. */
export const stemOf = (p) => path.basename(p, path.extname(p));

/** `sorted(set)` over strings, the ordering every problem list is emitted in. */
export const sortedUnique = (xs) => [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
/** `sorted(probs)` — SORTED, not deduped, which is what `_ran` fills a group with. */
export const sortedProblems = (xs) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * `k in d` for a Python dict — OWN keys only.
 *
 * Every membership test in this file reads a key that came out of a JSON document or a source
 * filename, and a bare `k in obj` would answer true for `constructor`, `toString` and the rest
 * of `Object.prototype`. A theme defining a `toString` voice token, or a skill file named
 * `valueOf.md`, would then be reported as missing by the reference and not by this port — a
 * divergence no cell can reach and no reviewer would look for.
 */
export const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);

/** `_harness_build._src_stems` — spec stems under `src/<folder>`, minus `_`-scaffolds. */
export function srcStems(folder) {
  const d = path.join(SRC, folder);
  if (!isDir(d)) return new Set();
  return new Set(globSorted(d, (n) => n.endsWith('.md') && !n.startsWith('_')).map(stemOf));
}

/**
 * A line reported by the doctor that is NOT a failure — `[note] …` rather than `[authoring] …`.
 *
 * ⚠ ONE PRODUCER, AND IT IS THE ONLY THING THAT NEEDED A SECOND CHANNEL. A build with a
 * doctrine pack off is LEGAL, and it leaves body prose citing rules that pack owns. That state
 * has to be visible — a silent dangling citation is how prose and boundary drift apart — but
 * reporting it as a problem would make `doctor` exit 1 over a configuration its owner chose.
 * So `cmdDoctor` prints notes and does not count them.
 */
export const NOTE = '[note] ';
export const isDoctorNote = (p) => p.startsWith(NOTE);

/** `tempfile.TemporaryDirectory()` — created, handed to `fn`, removed whatever happens. */
export function withTempDir(fn, prefix = 'geneseed-doctor-') {
  const tmp = mkdtempSync(path.join(os.tmpdir(), prefix));
  try { return fn(tmp); } finally { rmSync(tmp, { recursive: true, force: true }); }
}

