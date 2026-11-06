/**
 * The primitives the hook verbs share — `js/hosts/hooks.mjs` (the gates), `hooks-context.mjs`,
 * `hooks-learn.mjs` and `memory-files.mjs` — plus the activity writer's off switch and its
 * do-nothing `activity` verb, which `bin/geneseed-hook.mjs` reaches without loading the writer.
 *
 * Its own module because the verbs no longer share one: each loads only the code its verb runs
 * (`bin/geneseed-hook.mjs` imports per verb), and a gate is paid on every tool call. What lives
 * here is what at least two of them need, and nothing in it may spawn or reach the generator —
 * `memory-files.mjs` puts this module in the CLI's closure too.
 */
import { statSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { comparePaths } from '../lib/paths.mjs';
import { readTail } from '../lib/fs.mjs';

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
export const LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

export function splitLines(text) {
  if (!text) return [];
  const parts = text.split(LINE_BREAK);
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** The first window a Stop reads from a transcript's end; real transcripts reach 50 MB. */
const TAIL_BYTES = 2 * 1024 * 1024;

/**
 * A transcript reader for ONE hook invocation: `read(file, judge)` hands `judge(text, whole)`
 * the file's last `bytes`, then a window four times larger, until `judge` answers (anything
 * but null) or the window holds the whole file — where it must answer. Each window is read once
 * per reader, so the done gate and `learn` share one read when both run on the same Stop.
 * A read error (missing, unreadable) throws to the caller, uncached. Never a module-level cache:
 * the host appends between Stops, and a test rewrites the same path.
 */
export function tailReader(bytes = TAIL_BYTES) {
  const seen = new Map();
  return (file, judge) => {
    for (let n = bytes; ; n *= 4) {
      const key = `${n}:${file}`;
      if (!seen.has(key)) seen.set(key, readTail(file, n));
      const { text, start } = seen.get(key);
      const answer = judge(text, start === 0);
      if (answer !== null || start === 0) return answer;
    }
  };
}

/** `str.split()` with no argument — runs of whitespace, ends stripped, no empties. */
export function splitWords(s) {
  return s.split(/\s+/).filter(Boolean);
}

/**
 * stdin, decoded as UTF-8 with Python's universal newlines. Absent stdin reads empty.
 *
 * Read ONCE per process and kept: fd 0 drains on the first read, and the activity writer
 * (`bin/geneseed-hook.mjs`'s `trackActivity`) needs the payload the verb already consumed.
 */
let stdinText = null;
export function readStdin() {
  if (stdinText !== null) return stdinText;
  try {
    stdinText = readFileSync(0, 'utf8').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  } catch {
    stdinText = '';
  }
  return stdinText;
}

// The done gate's own list (#289): `./done-checks.mjs` reads it, `./hooks.mjs`'s rule-gate
// protects it. Here because both need it and only this module is in both closures.
export const DONE_LIST = '.geneseed/done-checks.txt';

// Law I's boundary half — rule-gate's credential scan, and the activity writer's redaction of
// every snippet it puts on disk. Here, not in `./hooks.mjs`, so the writer reads the one copy
// without loading the gates. High-precision vendor prefixes only — a generic "looks like
// entropy" scan would fire on every hash and lockfile, and a gate that cries wolf gets
// allow-listed. `sk-ant-` takes `_`: Anthropic keys are base64url, and a key whose first `_`
// fell inside the first 20 characters slipped through. GitHub's classic `ghp_` tokens really are
// alphanumeric only.
export const SECRET_RE =
  /\b(?:AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-ant-[A-Za-z0-9_-]{20,}|xox[abprs]-[0-9A-Za-z-]{10,})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/;

// ---- test-weakening twin: BEGIN — adapters/opencode/plugins/geneseed-context.js carries everything
// down to the END marker verbatim, with `export ` dropped (tests/plugins/context_done.test.mjs diffs the two).

/**
 * A test file: a path segment `test`, `tests`, `__tests__` or `spec`, or a name `*.test.*`,
 * `*.spec.*`, `*_test.*` or `test_*`. Give it a path relative to the repo, or an ancestor
 * folder named `test` makes every file a test.
 */
const TEST_PATH_RE = /(?:^|[\\/])(?:tests?|__tests__|spec)[\\/]|(?:^|[\\/])test_[^\\/]*$|\.(?:test|spec)\.[^\\/]*$|_test\.[^\\/]*$/;
export const isTestPath = (p) => TEST_PATH_RE.test(p);
// `\bxit`, or `process.exit(` reads as one; `(?<!mark)`, or `pytest.mark.skip(` counts twice.
const SKIP_MARKERS = [['.skip', /(?<!mark)\.skip\(/g], ['xit', /\bxit\(/g], ['xfail', /\bxfail\b/g],
  ['@Disabled', /@Disabled\b/g], ['@Ignore', /@Ignore\b/g], ['pytest.mark.skip', /\bpytest\.mark\.skip/g],
  ['t.Skip', /\bt\.Skip\(/g]];
const ASSERT_LINE_RE = /\bassert\w*!?\s*[.(]|\bexpect\s*\(|^assert\s/;
const COMMENT_LINE_RE = /^(?:\/\/|\/\*|\*|#)/;
// shortcut: only whole comment lines are dropped, so a marker in a string or a trailing comment, and
// any other `.skip(` (`stream().skip(1)`), still count. Upgrade by parsing the language; it is an advisory.
const code = (text) => text.split(/\r?\n/).filter((l) => !COMMENT_LINE_RE.test(l.trim())).join('\n');
// shortcut: a Set hides the loss of one of two identical lines, and `require.Equal`, `t.Errorf` and
// `.should` are not read as assertions. Upgrade by counting lines and widening `ASSERT_LINE_RE`.
const assertLines = (text) => new Set(text.split(/\r?\n/).map((l) => l.trim())
  .filter((l) => ASSERT_LINE_RE.test(l) && !COMMENT_LINE_RE.test(l)));

/**
 * What `pairs` of `[old, new]` text do to a test, as labels: a skip marker the new text has more
 * of (`.skip added`), or an assertion line gone with none new in its place (`assertion removed`).
 * A comment is no assertion, so commenting one out removes it. Cure the Cause's advisory half.
 */
export function weakenedBy(pairs) {
  const found = new Set();
  for (const [before, after] of pairs) {
    for (const [label, re] of SKIP_MARKERS) {
      if ((code(after).match(re) || []).length > (code(before).match(re) || []).length) found.add(`${label} added`);
    }
    const was = assertLines(before);
    const now = assertLines(after);
    if ([...was].some((l) => !now.has(l)) && [...now].every((l) => was.has(l))) found.add('assertion removed');
  }
  return [...found];
}
// ---- test-weakening twin: END

// One Roo-style `apply_diff` block: its SEARCH half, then its REPLACE half.
export const DIFF_BLOCK_RE = /<<<<<<< SEARCH\r?\n(?::start_line:\s*\d+\r?\n)?(?:-------\r?\n)?([\s\S]*?)\r?\n?=======\r?\n([\s\S]*?)\r?\n?>>>>>>> REPLACE/g;

/**
 * A write tool's input as `[old, new]` pairs for `weakenedBy`. `whole` is the file before a
 * whole-file write, which the input does not carry. NotebookEdit's input names no old text either,
 * so a cell that already held a marker reads as adding it.
 */
export function editPairs(ti, whole = '') {
  const text = (v) => (typeof v === 'string' ? v : '');
  const pairs = [];
  if (typeof ti.content === 'string') pairs.push([whole, ti.content]);
  if (typeof ti.new_string === 'string') pairs.push([text(ti.old_string), ti.new_string]);
  if (typeof ti.new_source === 'string') pairs.push(['', ti.new_source]);
  if (typeof ti.replace === 'string') pairs.push([text(ti.search), ti.replace]);
  for (const e of Array.isArray(ti.edits) ? ti.edits : []) {
    if (e && typeof e.new_string === 'string') pairs.push([text(e.old_string), e.new_string]);
  }
  if (typeof ti.diff === 'string') for (const m of ti.diff.matchAll(DIFF_BLOCK_RE)) pairs.push([m[1], m[2]]);
  return pairs;
}

const OFF = ['off', '0', 'false', 'no'];

/**
 * Whether the activity writer runs for the install at `root`: on unless `$GENESEED_ACTIVITY` or
 * the web console's `<root>/.geneseed-activity` flag says off — the same words, and the same
 * absent-means-on default, as the OpenCode plugin and `js/web/activity.mjs`. One file read: this
 * is paid on every hook call, and it is the only thing paid when tracking is off.
 */
export function activityOn(root) {
  if (OFF.includes(String(process.env.GENESEED_ACTIVITY ?? 'on').trim().toLowerCase())) return false;
  try {
    return !OFF.includes(readFileSync(path.join(root, '.geneseed-activity'), 'utf8').trim().toLowerCase());
  } catch {
    return true;
  }
}

/**
 * The `activity` verb, wired to the events no other verb runs on (UserPromptSubmit; SessionEnd
 * and SubagentStart on Claude and OpenClaude). It decides nothing and prints nothing: the entry's
 * `trackActivity` records the payload after every verb alike, this one included.
 */
export const cmdActivity = () => 0;

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
