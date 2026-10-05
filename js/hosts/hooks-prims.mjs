/**
 * The primitives the hook verbs share — `js/hosts/hooks.mjs` (the gates), `hooks-context.mjs`,
 * `hooks-learn.mjs` and `memory-files.mjs`.
 *
 * Its own module because the verbs no longer share one: each loads only the code its verb runs
 * (`bin/geneseed-hook.mjs` imports per verb), and a gate is paid on every tool call. What lives
 * here is what at least two of them need, and nothing in it may spawn or reach the generator —
 * `memory-files.mjs` puts this module in the CLI's closure too.
 */
import { statSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { comparePaths } from '../lib/paths.mjs';

// ---- Python path and text primitives -------------------------------------------------
// Small, and each one is here because a JS-idiomatic equivalent differs observably.
//
// THE RULE, CORRECTED IN P5d. It used to read "duplicating four helpers is cheaper than
// coupling a hook to the emitter", with `readText`/`writeText`/`normcase` as the stated
// exceptions. That is the wrong line, and `pyStrPath` is what proved it: it was a second
// implementation of `str(Path(p))` under a different NAME from `js/lib/fs.mjs`'s
// `toPlatformPath`, and the two disagreed. P5c found that `path.normalize` collapses `a/../b`
// where `PurePath` keeps it, fixed `toPlatformPath`, and gated it with a 25-path corpus — and
// none of that reached the hook, because a corpus finds what it is pointed at and nothing
// named `pyStrPath` was. The consequence was live: `sovereignBypass` compares an
// `excludes.json` entry against cwd, so a hand-edited `..` entry made the NODE hook stand
// down for a repo Python still gates. (Since the Python is gone, exclude entries resolve `..`
// and symlinks on every host — `context/sovereign-bypass-matches-a-dotdot-entry` is the cell.)
//
// So the line is not "duplicate rather than couple" — it is "one owner for anything that
// reproduces a language primitive, wherever it is used". `fs.mjs` carries no
// `child_process` and costs nothing at hook latency. What stays local is what is genuinely
// only the hook's (`fnmatch`, the transcript readers, `asOsError`'s errno table).
//
// AND `expanduser` WAS THE SECOND VIOLATION, closed here. The hook carried its own, which
// returned a `~user` path UNCHANGED while `js/hosts/hosts.mjs`'s single owner REFUSES the form —
// an adjudicated product decision (`TheTildeUserFormIsADeliberateDivergence`) that the hook
// was quietly exempt from because it had a private copy. It now imports the owner. The
// refusal throws, so `sovereignBypass` and `cmdContext` contain it per entry / per
// call. For the GATES that containment is not enough, and `guardGate` (`./hooks.mjs`) is the
// contract: these verbs exit 0 and signal on stdout, so "the gate blew up" and "the gate
// found nothing" would be the SAME observation to Claude — a crash would be a silent allow.
// A gate that cannot evaluate a call therefore asks, and says why. `resolvePath` comes from
// `js/hosts/hosts.mjs`, which every verb already imports — the hook had kept a private copy.

// NOT `js/lib/fs.mjs`'s `isFile`/`isDir` (the owner everywhere else), which every verb already
// loads: those RETHROW anything but a definite "not there" (EACCES above all), and a hook must
// answer every probe — an unreadable path is simply not a file to inject or a store to guard.
export const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
export const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/** `(p, *p.parents)` — the path and every ancestor, nearest first. */
export function selfAndParents(p) {
  const out = [p];
  let cur = p;
  for (;;) {
    const up = path.dirname(cur);
    if (up === cur) return out;
    out.push(up);
    cur = up;
  }
}

/**
 * `str.splitlines()`.
 *
 * `split('\n')` is not it: Python breaks on eleven boundaries, and a transcript or a
 * memory file carrying a form feed or U+2028 would be split by one implementation and not
 * the other. The trailing empty is dropped the way Python drops it (`"a\n"` is one line,
 * `""` is none).
 */
export function splitLines(text) {
  if (!text) return [];
  const parts = text.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** `str.split()` with no argument — runs of whitespace, ends stripped, no empties. */
export function splitWords(s) {
  return s.split(/\s+/).filter(Boolean);
}

/** stdin, decoded as UTF-8 with Python's universal newlines. Absent stdin reads empty. */
export function readStdin() {
  try {
    return readFileSync(0, 'utf8').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  } catch {
    return '';
  }
}

// The two output funnels, with Python's newline translation reproduced, are `printOut`/`printErr`
// in `js/lib/fs.mjs` — they moved there in P5c, beside `writeText`, which is the same rule for
// FILES, when `js/inspect/excludes.mjs` became the second caller; see that docblock for why the
// translation exists and which gate can see it. Each verb imports them as `out`/`err`.

/** `Path.glob`/`rglob` order: `sorted()` over paths, which is case-folded on Windows. */
export function sortPaths(list) {
  return list.slice().sort(comparePaths);
}

export function listDir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
