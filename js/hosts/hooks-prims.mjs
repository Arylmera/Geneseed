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

// ---- gate text twin: BEGIN — adapters/opencode/plugins/geneseed-guard.js carries everything down to
// the END marker verbatim, with `export ` dropped (tests/plugins/guard.test.mjs diffs the two).

/**
 * What each protected check is, for a person who has not read the diff: the files, what they are,
 * what an edit can do. Fixed text, so the governed agent cannot write its own case. A file is written
 * as `CANDIDATES` (`./geneseed-dir.mjs`) writes it, so tests/unit/gate_text.test.mjs compares the
 * two entry by entry, both ways: a string ending `/` is a folder, any other string a file, a regex
 * a file name.
 * @type {[(string | RegExp)[], string, string][]}
 */
export const GATE_FILES = [
  [['.github/workflows/', '.gitlab-ci.yml', 'Jenkinsfile', 'azure-pipelines.yml', '.circleci/'],
    'which defines the checks that run on every push',
    'those checks can get weaker or stop running, and a failure could go unseen'],
  [[/^eslint\.config\./, /^\.eslintrc/, 'biome.json', 'biome.jsonc', 'ruff.toml', '.golangci.yml', 'checkstyle.xml'],
    'which sets the rules the linter enforces',
    'those rules can get weaker, and bad code could pass unseen'],
  [['tsconfig.json'],
    'which sets how strictly types are checked',
    'the type checks can get weaker, and a type error could pass unseen'],
  [[/^jest\.config\./, /^vitest\.config\./, 'pytest.ini'],
    'which decides how the tests run',
    'tests can be skipped or loosened, and a failure could go unseen'],
  [['package.json', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'pyproject.toml', 'Cargo.toml', 'go.mod'],
    'which names the commands that test this project',
    'those commands can change, and a failing test could read as a pass'],
];
/**
 * Protected by being the lists themselves, so they are in no seed and stay outside `GATE_FILES`. Read
 * at the repo root only: a `packages/a/.geneseed/done-checks.txt` someone listed feeds no gate.
 * @type {[string, string, string][]}
 */
const GATE_LISTS = [
  ['.geneseed/protected-checks.txt', 'which lists the files this gate protects',
    'a check can lose its protection, and nothing would tell you'],
  ['.geneseed/done-checks.txt', 'which lists the checks that must pass before work counts as done',
    'work could count as done without passing a check'],
];
// Matches at any depth: a user may list `packages/a/tsconfig.json`, and it is still a tsconfig.
const gateIs = (rel, file) => {
  if (typeof file !== 'string') return file.test(rel.slice(rel.lastIndexOf('/') + 1));
  return file.endsWith('/') ? `/${rel}`.includes(`/${file}`) : `/${rel}`.endsWith(`/${file}`);
};
const GATE_FILE_OTHER = [null, 'which this project lists as a protected check',
  'that check can get weaker or stop running, and a failure could go unseen'];

// `ruleGateTarget`'s answers: name, what it is, what the safe line calls it, whose call it is, impact.
// Memory has none: it is written freely (owner decision, 2026-11-08).
const GATE_RULE = ['this rule', 'what becomes a rule'];
const GATE_STORES = {
  'user-rules.md': ['user-rules.md', 'your standing rules, which the agent obeys in every session', ...GATE_RULE,
    'the text binds every later session until you remove it'],
  'the rule draft': ['the rule draft', 'which can become one of your standing rules', ...GATE_RULE,
    'the text can become a rule that binds every later session'],
  'a hard link': ['a second name of a rule file', 'which writes to your standing rules or the rule draft', ...GATE_RULE,
    'the text can bind every later session until you remove it'],
};

// Bidi and zero-width marks too (`\p{C}`): they make a name read as something it is not. A double
// quote of any shape turns to `'`, or a name could seem to close its own quotes.
const gateStrip = (v) => String(v ?? '').replace(/[\p{C}\p{Zl}\p{Zp}]/gu, '').replace(/["\u201C-\u201F\uFF02]/g, "'").trim();

/**
 * An agent-supplied value in the human part. Clipped in the middle, because the end of a path names
 * the file. Quotes mark a name; they do not stop one reading like a sentence. `...` is ASCII so that
 * clipping alone does not force the quotes.
 */
export function gateName(value) {
  const c = [...gateStrip(value)];
  const text = c.length > 60 ? `${c.slice(0, 20).join('')}...${c.slice(-37).join('')}` : c.join('');
  return /^[A-Za-z0-9._/-]+$/.test(text) ? text : `"${text}"`;
}

const gatePath = (p) => String(p ?? '').replace(/\\/g, '/');
// Every line end a viewer may honour: a line break that this missed would hide a line from the count.
const gateLines = (text) => {
  const lines = text.split(/\r\n|[\r\n\u2028\u2029]/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
};

/**
 * ` (+3 lines, -1 line)` from `editPairs`, or nothing when no line differs. Each pair loses its common
 * leading and trailing lines. Exact for one changed region; with several it overstates, and it
 * never hides a change. A pair says nothing of how often it applies, so a caller whose input has
 * `replace_all`, at the top or in an `edits` entry, passes no pairs and no count shows: the agent sets
 * that flag, and a 40-place edit must not read as `+1 line, -1 line`.
 */
export function gateCount(pairs) {
  let added = 0;
  let removed = 0;
  for (const [before, after] of pairs) {
    const a = gateLines(before);
    const b = gateLines(after);
    const most = Math.min(a.length, b.length);
    let head = 0;
    while (head < most && a[head] === b[head]) head += 1;
    let tail = 0;
    while (tail < most - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
    removed += a.length - head - tail;
    added += b.length - head - tail;
  }
  const n = (sign, v) => `${sign}${v} line${v === 1 ? '' : 's'}`;
  const parts = [...(added ? [n('+', added)] : []), ...(removed ? [n('-', removed)] : [])];
  return parts.length ? ` (${parts.join(', ')})` : '';
}

const gateEdit = (f, shown, what) => `${f.shell ? 'This command writes to' : 'This edit changes'} ${shown}`
  + `${f.pairs ? gateCount(f.pairs) : ''}, ${what}.`;

const GATE_ELSEWHERE = 'This command runs on another repository, through --git-dir or --work-tree, which the gate did not read.';
const GATE_DO_IT = 'You can make this change yourself, outside the agent.';
const GATE_RUN_IT = 'You can run this command yourself, outside the agent.';
const GATE_EXTERNAL = { rule: 'External Gate', safe: 'Deny, unless you asked for this change.',
  tail: 'do not write this file another way', can: GATE_DO_IT };
const GATE_LOSS = { rule: 'Deletion Is Deliberate', quote: true, can: GATE_RUN_IT };

// `quote` marks the only asks that may carry the agent's words. External Gate, Sealed Secrets and
// Persist Insight never do: there the agent's opinion is the conflict of interest.
const GATE_ASKS = {
  check: (f) => {
    const rel = gatePath(f.name);
    const [, what, impact] = GATE_LISTS.find(([list]) => list === rel)
      ?? GATE_FILES.find(([files]) => files.some((n) => gateIs(rel, n))) ?? GATE_FILE_OTHER;
    return { ...GATE_EXTERNAL, line: gateEdit(f, gateName(rel), what), impact,
      why: 'the agent\'s own work is judged by this file' };
  },
  config: (f) => ({ ...GATE_EXTERNAL, line: gateEdit(f, gateName(gatePath(f.name)), 'which controls the gates that watch the agent'),
    why: 'a gate the agent can edit is a gate it can switch off',
    impact: 'a gate can stop working, and nothing would tell you' }),
  store: (f) => {
    const [name, what, label, owner, impact] = GATE_STORES[f.name] ?? GATE_STORES['user-rules.md'];
    return { rule: 'Persist Insight', line: gateEdit(f, name, what), safe: `Deny, unless you asked for ${label}.`,
      why: `${owner} is your decision`, impact, tail: 'ask the user; do not write it another way', can: GATE_DO_IT };
  },
  secret: (f) => ({ rule: 'Sealed Secrets', line: `This edit puts a credential-shaped string in ${gateName(gatePath(f.name))}.`,
    safe: 'Deny, then keep the value in .env or a secret manager.',
    why: 'a secret in a tracked file reaches everyone who can read the repository',
    impact: 'the secret can land in a commit, and then it must be rotated',
    tail: 'keep the value in .env; do not write it another way',
    can: 'You can put the value in .env or a secret manager yourself.' }),
  'force-push': (f) => ({ ...GATE_LOSS, line: `This command force-pushes the protected branch ${gateName(f.name)} on the remote.`,
    safe: 'Deny, then push without --force.', why: 'a force push replaces the remote history',
    impact: 'commits that exist only on the remote can be lost for everyone',
    can: 'You can push without --force, or run this command yourself.' }),
  'branch-delete': (f) => ({ ...GATE_LOSS, line: `This command deletes the protected branch ${gateName(f.name)}.`,
    safe: 'Deny, unless you mean to remove this branch.', why: 'the project depends on a protected branch',
    impact: 'commits that only this branch holds can be lost for everyone' }),
  'remote-branches': () => ({ ...GATE_LOSS, line: 'This command rewrites or deletes many remote branches, protected ones included.',
    safe: 'Deny, then push one named branch.', why: 'it makes the remote match this repository, branch by branch',
    impact: 'branches and commits that exist only on the remote can be lost for everyone' }),
  'discard-work': () => ({ ...GATE_LOSS, line: 'This command discards uncommitted changes that git cannot bring back.',
    safe: 'Deny, then commit or stash the work first.', why: 'uncommitted work exists nowhere else',
    impact: 'those changes are gone for good' }),
  'lose-commits': () => ({ ...GATE_LOSS, line: 'This command drops commits that no remote and no other branch holds.',
    safe: 'Deny, then keep them on a branch first.', why: 'those commits exist only here',
    impact: 'only the reflog can bring them back, and only for a while' }),
  // Git's safety net itself, so `lose-commits`' reflog line would be false here.
  'drop-recovery': () => ({ ...GATE_LOSS, line: 'This command deletes the history git uses to recover lost commits.',
    safe: 'Deny, unless you mean to give up that recovery.', why: 'it is the last copy of work lost earlier',
    impact: 'commits lost earlier can never come back' }),
  'delete-files': () => ({ ...GATE_LOSS, line: 'This command deletes files that git cannot restore.',
    safe: 'Deny, unless you know these files can go.', why: 'git holds no copy of them',
    impact: 'those files are gone for good' }),
  unverified: () => ({ ...GATE_LOSS, line: 'This command may lose data, and the gate could not work out what it removes.',
    safe: 'Deny, unless you have checked the command yourself.', why: 'the gate cannot read what this command touches',
    impact: 'data that nothing else holds could be lost' }),
  catastrophic: (f) => ({ ...GATE_LOSS,
    line: `This command, ${gateName(f.name)}, would destroy a filesystem root, a drive, the home directory or a whole disk.`,
    safe: 'Deny.', why: 'nothing could restore what it removes', impact: 'everything under that path is gone for good',
    can: 'You can check what this command was meant to remove.' }),
  'root-scan': (f) => ({ rule: 'Commands Must Return', quote: true, line: `This command, ${gateName(f.name)}, scans a whole filesystem root.`,
    safe: 'Deny, then search a specific directory.', why: 'a whole root spans every drive',
    impact: 'the scan can run for hours', tail: 'search one named directory',
    can: 'You can name the directory to search.' }),
  // Routine and frequent, so one line: three more would train the user to stop reading all of them.
  commit: () => ({ rule: 'Consent Before Push', quote: true, short: true,
    line: 'This command commits or pushes with git, which needs your approval each time.',
    why: 'every commit and push is your decision', can: GATE_RUN_IT }),
  // The next four are the OpenCode guard's alone: no hook reads a key path, a stream, a wiki manifest
  // or an unknown tool's arguments, and the guard only refuses them. `wiki` has no rule to name.
  'secret-file': (f) => ({ rule: 'Sealed Secrets', line: `This edit writes to ${gateName(gatePath(f.name))}, a file that holds a secret or key.`,
    safe: 'Deny, then change this file yourself.', why: 'a secret or key file is never for the agent to write',
    impact: 'the agent can replace a key that grants access', tail: 'leave this file alone', can: GATE_DO_IT }),
  stream: (f) => ({ ...GATE_EXTERNAL, line: `This edit names ${gateName(gatePath(f.name))}, an NTFS stream that writes through to the file it hangs on.`,
    safe: 'Deny, then have the agent name the file itself.', why: 'a stream hides which file really changes',
    impact: 'a file can change with no gate seeing its name', tail: 'name the file itself' }),
  wiki: (f) => ({ line: `This edit changes the protected wiki folder ${gateName(f.name)}.`,
    safe: 'Deny, unless you asked for this change.', why: 'you marked this folder as closed to the agent',
    impact: 'notes you protected can change', tail: 'leave this folder alone', can: GATE_DO_IT }),
  'deep-args': (f) => ({ rule: 'Persist Insight', line: `The arguments of ${gateName(f.name)} nest too deep to read, so a write to your rules cannot be ruled out.`,
    safe: 'Deny, unless you know what this call writes.', why: 'what the gate cannot read, it cannot clear',
    impact: 'the call can write to your rules unseen', tail: 'ask the user; do not write it another way', can: GATE_DO_IT }),
  // It reports a crash, not a change, so it has no rule to name.
  'gate-error': (f) => ({ line: `Geneseed gate error: the check failed with ${gateName(f.name)}, so nothing judged this call.`,
    safe: 'Deny, then run geneseed doctor.', why: 'a gate that crashed cannot say this call is safe',
    impact: 'this call runs with no check at all', can: 'You can run geneseed doctor to find the fault.' }),
};

/**
 * The text a gate shows, one sentence per line, so it reads the same if a host folds the newlines.
 * `mode` is `ask` (a person can answer), `refused` (nothing can be allowed and the model is the only
 * reader, so it must relay the words) or `warned` (the call runs anyway). `facts` is `name` (the path,
 * branch, command excerpt, error or `ruleGateTarget` answer), `pairs` (`editPairs`, for the count),
 * `shell` (reached through a command, which has no count), `says` (the call's own `description`) and
 * `redirected` (`gateLoss`'s: the loss the text names was read from a repository the command leaves).
 * The safe choice is line 2, so it stays in the part of a dialog that shows without scrolling. The
 * caller adds the host's wrapping: Bob's `[geneseed]` prefix and `BOB_FINAL` are not here.
 */
export function gateText(id, mode, facts = {}) {
  const a = GATE_ASKS[id](facts);
  const tag = a.rule ? ` (${a.rule})` : '';
  // After the safe choice, so that it keeps its place in the part of a dialog that shows.
  const far = facts.redirected ? [GATE_ELSEWHERE] : [];
  if (mode === 'warned') return `${a.line}${tag}\nThis ran without a prompt, because Bob has no approval step.`;
  if (mode === 'refused') {
    return [`Tell the user this, word for word: ${a.line}`, ...far, `It was refused because ${a.why}.${tag}`, a.can,
      ...(a.tail ? [`Agent: ${a.tail}.`] : [])].join('\n');
  }
  const c = [...(a.quote ? gateStrip(facts.says) : '')];
  return [...(a.short ? [`${a.line}${tag}`]
    : [a.line, `Safe choice: ${a.safe}${tag}`, ...far, `It asks because ${a.why}.`, `If you allow it, ${a.impact}.`]),
  ...(c.length ? [`The agent says (not checked): "${c.length > 100 ? `${c.slice(0, 97).join('')}...` : c.join('')}"`] : []),
  ...(a.tail ? [`Agent: if refused, ${a.tail}.`] : [])].join('\n');
}

// Said when `gateText` itself fails. It fits every mode, so nothing about it can fail.
const GATE_UNSAID = 'Geneseed could not describe this call. Check what it does before you trust it.';

/**
 * `gateText` that cannot throw, and the only way a gate reaches it. Every catch around a gate is a
 * pass or a lesser verdict (`guardGate`, a shell reader, the guard's own), so a bug in the words would
 * otherwise change what the gate decides.
 */
export function gateSafe(id, mode, facts) {
  try { return gateText(id, mode, facts); } catch { return GATE_UNSAID; }
}

// `lossReason`'s sentences, by their fixed parts only: the rest is the agent's command, so a pattern
// anchored there could be steered. Order matters: `git clean` ends in an agent's path.
/** @type {[RegExp, string][]} */
const GATE_LOSS_REASONS = [
  [/^the gate could not verify /, 'unverified'],
  [/^`git push --(?:mirror|prune)` |^a forced `git push --all` /, 'remote-branches'],
  [/^`git push` would force-push the protected branch (.+)$/, 'force-push'],
  [/^`git (?:push|branch -D)\b.* (?:would delete|deletes) the protected branch (.+)$/, 'branch-delete'],
  [/^`git clean` would delete untracked files | which (?:nothing could|git cannot) restore$| deletes git's own data$| deletes a whole repository or worktree$/, 'delete-files'],
  [/ would discard uncommitted changes \(.*\)$| deletes stashed work$/, 'discard-work'],
  [/ recovery depends on$/, 'drop-recovery'],
  [/ holds$/, 'lose-commits'],
];

/**
 * The `gateText` id, branch and `redirected` flag for a `lossReason` sentence. One this table does not
 * know reads as `unverified`, the most cautious text; tests/unit/gate_text.test.mjs holds every
 * sentence to an id.
 */
export function gateLoss(reason) {
  const direct = reason.replace(/ \(and --git-dir\/--work-tree points it at a repository the gate did not read\)$/, '');
  const redirected = direct !== reason;
  const text = direct.replace(/ on the protected branch \S*$/, '');
  for (const [re, id] of GATE_LOSS_REASONS) {
    const m = re.exec(text);
    if (m) return { id, name: m[1], redirected };
  }
  return { id: 'unverified', redirected };
}
// ---- gate text twin: END

/**
 * The `permissionDecision: "ask"` document, in Python's compact `json.dumps` spelling: `, ` and
 * `: ` separators, and `ensure_ascii` — every code unit past `~` as a lowercase `\uXXXX`, which is
 * why a reason's em dash reaches stdout as `—`.
 *
 * A TEMPLATE, NOT `js/lib/json.mjs`'s `jsonDumpsCompact`. The keys are fixed and the one value
 * is a string, so the general serializer bought nothing here — and it cost every tool call a
 * 378-line module parse, being the only thing on the gate path that needed it.
 * `tests/unit/hook_gates.test.mjs` holds the two byte-identical over non-ASCII reasons.
 */
export function askDecision(reason) { return decisionDoc('ask', reason); }

export function decisionDoc(decision, reason) {
  return `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "${decision}", `
    + `"permissionDecisionReason": ${asciiJson(reason)}}}\n`;
}

export const asciiJson = (s) => JSON.stringify(s)
  .replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

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
 * on Claude and OpenClaude; SubagentStart runs `context` since the agent loadout). It decides nothing and prints nothing: the entry's
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
