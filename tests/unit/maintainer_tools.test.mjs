/**
 * `geneseed-build --sync-themes` — the tool that rewrites committed theme files.
 *
 * WHY IT IS GATED THIS HARD. `--sync-themes` edits files a maintainer has already committed, in
 * place. A wrong answer is not a crash; it is a diff someone reviews quickly, approves, and
 * ships. So the cases assert the exact bytes left behind, not merely a JSON-equal value.
 *
 * The twenty cases live in `tests/fixtures/sync_themes_cases.json`: a theme directory going in,
 * the report that must be printed, the exit status, and the files that must come back out. They
 * run through `tests/fixtures/sync_themes_probe.mjs` because the entry point is a CLI flag.
 *
 * ⚠ TWO PROPERTIES VARY BY MACHINE, and each is claimed where it is true rather than everywhere.
 *
 *   * The line SEPARATOR is the running platform's — CRLF here, LF on the ubuntu runner. Report
 *     and file CONTENT are therefore compared with newlines folded, and the separator gets its
 *     own test against `os.EOL`.
 *   * The visit ORDER is path collation, case-folded on Windows and code-point on posix, so one
 *     case sees `apple.json` before `Zebra.json` here and after it there. That order is
 *     RE-DERIVED for the running platform rather than stored — a stored order could only be
 *     right on one of the two.
 *
 * Asserting either of those flatly is not hypothetical: doing so turned `validate
 * (ubuntu-latest)` red with all twenty cases failing against code that was behaving correctly.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import os from 'node:os';

import { makeSandbox } from '../helpers/sandbox.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PROBE = path.join(ROOT, 'tests', 'fixtures', 'sync_themes_probe.mjs');
const { cases: CASES } = JSON.parse(readFileSync(
  path.join(ROOT, 'tests', 'fixtures', 'sync_themes_cases.json'), 'utf8'));

/** Run the Node probe over one recorded case; returns raw stdout/stderr plus the result doc. */
function runProbe(row) {
  const sb = makeSandbox('sync-');
  try {
    const job = path.join(sb.path, 'job.json');
    const res = path.join(sb.path, 'result.json');
    writeFileSync(job, JSON.stringify({ files: row.files }), 'utf8');
    const p = spawnSync(process.execPath, [PROBE, job, res],
      { cwd: ROOT, windowsHide: true, maxBuffer: 1 << 26 });
    assert.equal(p.status, 0,
      `the probe failed on ${row.name}: ${(p.stderr ?? Buffer.alloc(0)).toString('utf8')}`);
    return { out: p.stdout, err: p.stderr, res: JSON.parse(readFileSync(res, 'utf8')) };
  } finally {
    sb.cleanup();
  }
}

const byName = Object.fromEntries(CASES.map((r) => [r.name, r]));
/** Text with the line separator folded — the CONTENT, free of the platform. */
const fold = (s) => (Buffer.isBuffer(s) ? s.toString('utf8') : s).replaceAll('\r\n', '\n');
/** `after` holds file BYTES, base64-encoded, because a written file is bytes and not text. */
const b64 = (s) => Buffer.from(s, 'base64');
const folded = (buf) => Buffer.from(fold(buf), 'utf8');

/**
 * ⚠ THE MACHINE-VARYING PROPERTY IN THIS FIXTURE, and the one case that can see it.
 *
 * Theme files are visited in path-collation order, which is CASE-FOLDED on Windows and raw
 * code-point order on posix. So `apple.json` precedes `Zebra.json` here and follows it on the
 * ubuntu runner, and both are correct on their own platform; `js/hosts/installs.mjs`'s docblock
 * says so, and `comparePaths` is built on the same `normcase`.
 *
 * The order is therefore RE-DERIVED for the running platform below rather than stored, because
 * a stored order can only ever be right on one of the two.
 */
const COLLATION_CASE = 'theme-files-are-visited-in-the-references-order';
const lines = (s) => fold(s).split('\n').filter((ln) => ln !== '');

/**
 * The collation key, written out rather than imported from `js/lib/paths.mjs`. Deriving the
 * expectation from the code under test would make this agree with any drift in it.
 */
const pathSortKey = (n) => (process.platform === 'win32' ? n.toLowerCase() : n);
const byPyPath = (a, b) => (pathSortKey(a) < pathSortKey(b) ? -1 : pathSortKey(a) > pathSortKey(b) ? 1 : 0);

// Run every case ONCE, at module scope: twenty child processes is the whole cost of this file.
const ANSWERS = Object.fromEntries(CASES.map((r) => [r.name, runProbe(r)]));

test('the fixture covers both directions and the refusal', () => {
  // Without all three arms the comparisons below are about one path. Cheap, and it is the check
  // that would have caught a fixture edited down to the happy case.
  assert.equal(CASES.length, 20, 'the case list has changed size');
  assert.ok(CASES.some((r) => r.changed === 1), 'no case that changes a theme');
  assert.ok(CASES.some((r) => r.changed === 0), 'no case that changes nothing');
  assert.ok(CASES.some((r) => r.exit === 2), 'no case that refuses');
});

test('the printed report is what each case says it should be', () => {
  for (const row of CASES) {
    const got = ANSWERS[row.name];
    const detail = `\n  want: ${row.stdout.slice(0, 300)}\n`
      + `  got:  ${fold(got.out).slice(0, 300)}`;
    if (row.name === COLLATION_CASE) {
      // WHICH lines were printed is platform-free; the ORDER they came in is this platform's
      // collation and is asserted, re-derived, in its own test below. Relaxed for this case
      // ALONE — the other nineteen keep the exact sequence.
      assert.deepEqual(lines(got.out).sort(), lines(row.stdout).sort(),
        `${row.name}: a different SET of report lines was printed${detail}`);
    } else {
      assert.equal(fold(got.out), row.stdout,
        `${row.name}: \`--sync-themes\` printed different CONTENT — the em dash lives in this `
        + `comparison too.${detail}`);
    }
    assert.equal(fold(got.err), row.stderr, `${row.name}: stderr differs`);
  }
});

test('theme files are visited in THIS platform\'s Path collation order', () => {
  const row = byName[COLLATION_CASE];
  const themes = Object.keys(row.files).filter((n) => n !== '_TEMPLATE.json');

  // ⚠ THE FIXTURE MUST BE ABLE TO TELL THE TWO ORDERS APART, or this passes vacuously on both
  // platforms while asserting nothing — the same trap `win_user_path.json` fell into. `Zebra`
  // and `apple` disagree under case-folded and code-point collation; two lower-case names would
  // not, and would leave the whole row decorative.
  const codePoint = [...themes].sort();
  const caseFolded = [...themes].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
  assert.notDeepEqual(codePoint, caseFolded,
    `the recorded names ${themes} sort identically under both collations, so this row cannot `
    + 'observe the property it is named for');

  const want = [...themes].sort(byPyPath);
  const out = ANSWERS[COLLATION_CASE].out.toString('utf8');
  const got = themes.map((n) => [n, out.indexOf(n)]).filter(([, i]) => i >= 0)
    .sort((a, b) => a[1] - b[1]).map(([n]) => n);
  assert.deepEqual(got, themes.length ? want : [],
    `\`--sync-themes\` visited ${got} but Python's sorted(Path) orders them ${want} on `
    + `${process.platform}`);

});

test('every written file carries this platform\'s line separator', () => {
  // THE HALF THE FOLD ABOVE GIVES UP, ASSERTED SEPARATELY RATHER THAN LOST. `writeText`
  // translates to `os.linesep`, so a multi-line file this tool rewrote must carry the RUNNING
  // platform's separator — CRLF here, LF on the ubuntu runner. Folding both sides and stopping
  // there would have quietly retired the newline claim that `mutate.mjs`'s M1 exists for.
  //
  // ⚠ ONLY THE FILES THE TOOL REWROTE, and the first draft asserted it of all of them and went
  // red here. A file `--sync-themes` left ALONE comes back with its INPUT's bytes — LF, because
  // the corpus is written with `\n` — and that is the no-op guarantee, not a translation
  // failure. `writeText` only translates what it writes.
  let checked = 0;
  for (const row of CASES) {
    for (const [name, enc] of Object.entries(ANSWERS[row.name].res.files)) {
      const buf = b64(enc);
      const body = buf.toString('utf8');
      if (!body.includes('\n')) continue;                 // single-line: nothing to separate
      if (row.files[name] !== undefined
          && Buffer.compare(buf, Buffer.from(row.files[name], 'utf8')) === 0) continue;
      checked += 1;
      if (os.EOL === '\r\n') {
        assert.ok(!/(?<!\r)\n/.test(body),
          `${row.name}/${name} carries a bare LF on a CRLF platform — writeText's os.linesep `
          + 'translation is not being applied');
      } else {
        assert.ok(!body.includes('\r\n'),
          `${row.name}/${name} carries a CRLF on an LF platform`);
      }
    }
  }
  assert.ok(checked >= 5, `only ${checked} multi-line files were REWRITTEN, so this is thin`);
});

test('the written files are what the reference wrote', () => {
  for (const row of CASES) {
    const got = ANSWERS[row.name];
    assert.deepEqual(Object.keys(got.res.files).sort(), Object.keys(row.after).sort(),
      `${row.name}: a different set of files came back`);
    for (const name of Object.keys(row.after).sort()) {
      assert.deepEqual(folded(b64(got.res.files[name])), folded(b64(row.after[name])),
        `${row.name}/${name} differs after the sync — a JSON-equal answer is not the same `
        + 'answer for a tool that edits committed files');
    }
  }
});

test('the verdict and the exit status are what the reference answered', () => {
  for (const row of CASES) {
    const got = ANSWERS[row.name];
    assert.equal(got.res.changed, row.changed, `${row.name}: wrong \`changed\``);
    assert.equal(got.res.exit, row.exit, `${row.name}: wrong exit`);
  }
});

test('the tool actually does something in each direction', () => {
  // THE POSITIVE CONTROLS. Without them, twenty cases that all answered nothing would satisfy
  // the comparisons above perfectly — stored silence matched by silence.
  const out = (name) => byName[name].stdout;
  assert.match(out('a-key-that-already-exists-anchors-the-insertion'),
    /added 1 key\(s\) from the template/);
  assert.match(out('a-key-that-already-exists-anchors-the-insertion'),
    /RESTYLE these in this theme's voice: B/);
  assert.match(out('nothing-to-do-says-so-once'), /all themes already carry every template key\./);
  assert.match(out('an-extra-key-is-reported-and-kept-when-nothing-is-missing'), /not removed: ZZZ/);
  assert.match(out('an-unreadable-template-refuses-instead-of-reporting-sync'),
    /is missing or unreadable/);
  for (const [name, changed, code] of [
    ['a-key-that-already-exists-anchors-the-insertion', 1, 0],
    ['nothing-to-do-says-so-once', 0, 0],
    ['several-missing-keys-insert-in-template-order', 1, 0],
    ['an-unreadable-template-refuses-instead-of-reporting-sync', null, 2],
    ['a-missing-template-refuses-too', null, 2]]) {
    assert.equal(ANSWERS[name].res.changed, changed, `${name}: changed`);
    assert.equal(ANSWERS[name].res.exit, code, `${name}: exit`);
  }
});

test('the churn guarantee is kept to the byte', () => {
  // THE INSERTION IS TEXTUAL, stated absolutely rather than only replayed. Both Unicode
  // spellings survive, and ONLY the new line differs from the input — which is the promise a
  // maintainer relies on when this tool rewrites a file they own.
  const name = 'a-one-key-sync-keeps-both-unicode-spellings-byte-for-byte';
  const after = b64(ANSWERS[name].res.files['mytheme.json']).toString('utf8')
    .replaceAll('\r\n', '\n');
  assert.equal(after,
    '{\n  "A": "hello — caf\\u00e9",\n  "B": "<b>",\n  "C": "\\u2603 world"\n}\n');
  const before = byName[name].files['mytheme.json'];
  assert.deepEqual(after.split('\n').filter((ln) => !ln.includes('"B"')), before.split('\n'),
    'a line other than the inserted one moved');
});

test('the no-op case really leaves the bytes alone', () => {
  const name = 'an-in-sync-theme-is-not-rewritten-at-all';
  assert.deepEqual(b64(ANSWERS[name].res.files['mytheme.json']),
    Buffer.from(byName[name].files['mytheme.json'], 'utf8'));
});

test('the fallback case really reaches the fallback', () => {
  // The re-dump is the one branch no shipped theme reaches, so the corpus has to prove its own
  // case gets there — a one-line file that came back one-line would mean the surgical path
  // answered and the fallback is still ungated.
  const name = 'an-unconventionally-formatted-theme-falls-back-to-a-full-re-dump';
  assert.equal(b64(ANSWERS[name].res.files['mytheme.json']).toString('utf8')
    .replaceAll('\r\n', '\n'),
  '{\n  "A": "hello",\n  "B": "<b>",\n  "ZED": "café — raw"\n}\n');
});

test('the container value is written with Python\'s separators', () => {
  // `json.dumps({...})` writes `{"a": 1, "b": 2}`; `JSON.stringify` writes `{"a":1,"b":2}`. One
  // key in the real template can tell them apart, and after the cut this spelling is the SPEC
  // rather than a compatibility note.
  const after = b64(ANSWERS['the-one-container-value-in-the-real-template'].res.files['mytheme.json'])
    .toString('utf8');
  assert.ok(after.includes('"AGENT_COLORS": {"architect": "primary", '),
    `the container value lost Python's separators: ${after.slice(0, 300)}`);
});

test('the template still has exactly one container value', () => {
  // THE CLAIM THIS CORPUS IS BUILT ON, re-derived rather than trusted: the day a second
  // non-string value lands in the template, that one case stops being the whole of the trap.
  const tmpl = JSON.parse(readFileSync(path.join(ROOT, 'themes', '_TEMPLATE.json'), 'utf8'));
  const containers = Object.entries(tmpl).filter(([, v]) => typeof v !== 'string')
    .map(([k]) => k).sort();
  assert.deepEqual(containers, ['AGENT_COLORS'],
    `themes/_TEMPLATE.json's non-string values are ${containers}; the corpus covers `
    + 'AGENT_COLORS only');
});

test('the validate-only comparison is retired where its absolute half lives', () => {
  // ⚠ RETIREMENT, MADE CHECKABLE. Four of the reference's fourteen drove `--validate-only` as a
  // two-implementation comparison, and that half was observed FLAKY and then diagnosed: both
  // sides run `doctor`, whose emit rewrites the machine-wide hook shim and announces that it
  // did, so whichever ran FIRST printed a repair line the second did not. A test coupled to
  // shared mutable state neither implementation owns cannot be ported, only replaced — and the
  // replacement predates this row.
  const owner = readFileSync(path.join(ROOT, 'tests', 'unit', 'generate.test.mjs'), 'utf8');
  assert.ok(/ValidateOnly/i.test(owner),
    'tests/unit/generate.test.mjs no longer carries the ValidateOnly block — the absolute half '
    + 'of `--validate-only` is now ungated, and the comparison that used to cover it is gone');
});
