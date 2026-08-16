/**
 * `--sync-themes`, replayed against a corpus RECORDED FROM THE REFERENCE.
 *
 * SUCCESSOR TO `tests/test_maintainer_tools_parity.py`'s sync-themes half. Ten of its fourteen
 * tests were already ABSOLUTE — the churn guarantee's exact bytes, the no-op case really leaving
 * bytes alone, the fallback case really reaching the fallback, the template's one container
 * value — and those are what survive. Written before the port existed, that file found three
 * divergences by being written, and the absolute tier is why.
 *
 * THE CORPUS IS RECORDED, the fourth use of that move in this phase and the one with the most at
 * stake: twenty cases whose inputs a cell cannot build, and whose answers include RAW BYTES. It
 * was taken from `tests/fixtures/sync_themes_probe.py` on 2026-08-16 into
 * `tests/__snapshots__/sync_themes.json` and is replayed against the Node probe beside it.
 *
 * ⚠ STDOUT AND STDERR ARE RECORDED AS BASE64, not as text, and that is not caution: the newline
 * translation and the em dash BOTH live in this comparison. A text round trip through JSON would
 * erase the first, and the whole reason `--sync-themes` has a byte corpus is that it rewrites
 * files a maintainer has committed.
 *
 * ⚠ THE `--validate-only` HALF IS NOT HERE, and its absence is the row's own finding. That
 * comparison was OBSERVED FLAKY and then DIAGNOSED: it runs both implementations back to back,
 * each runs `validate` → `doctor`, whose `[shim]` check reads the machine-wide hook shim and
 * whose emit REWRITES it when stale, announcing that it did. So when anything earlier in the
 * suite left that shim pointing at a vanished temp dir, the FIRST implementation printed the
 * repair line and the second did not. The coupling is to the DEVELOPER'S MACHINE — shared
 * mutable state neither implementation owns — which is why no cell could ever adjudicate that
 * verb. It was deliberately not fixed, because the comparison dies at P4 and the absolute half
 * already lives in `tests/unit/generate.test.mjs`'s ValidateOnly block, which runs ONE
 * implementation and hands every child a sandboxed home.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { makeSandbox } from '../helpers/sandbox.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PROBE = path.join(ROOT, 'tests', 'fixtures', 'sync_themes_probe.mjs');
const CORPUS = JSON.parse(readFileSync(
  path.join(ROOT, 'tests', '__snapshots__', 'sync_themes.json'), 'utf8'));

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

const byName = Object.fromEntries(CORPUS.rows.map((r) => [r.name, r]));
const b64 = (s) => Buffer.from(s, 'base64');
const text = (s) => b64(s).toString('utf8').replaceAll('\r\n', '\n');

// Run every case ONCE, at module scope: twenty child processes is the whole cost of this file.
const ANSWERS = Object.fromEntries(CORPUS.rows.map((r) => [r.name, runProbe(r)]));

test('the recording is the shape it claims to be', () => {
  assert.equal(CORPUS.rows.length, 20, 'the recorded corpus has changed size');
  assert.match(CORPUS.recorded_with.python, /^\d+\.\d+$/);
  // The corpus must contain BOTH directions, or the comparisons below are about one arm.
  assert.ok(CORPUS.rows.some((r) => r.changed === 1), 'no case that changes a theme');
  assert.ok(CORPUS.rows.some((r) => r.changed === 0), 'no case that changes nothing');
  assert.ok(CORPUS.rows.some((r) => r.exit === 2), 'no case that refuses');
});

test('the printed report is byte-identical to what the reference printed', () => {
  for (const row of CORPUS.rows) {
    const got = ANSWERS[row.name];
    assert.deepEqual(got.out, b64(row.stdout_b64),
      `${row.name}: \`--sync-themes\` printed different BYTES. The newline translation and the `
      + `em dash both live in this comparison.\n  want: ${text(row.stdout_b64).slice(0, 300)}\n`
      + `  got:  ${got.out.toString('utf8').replaceAll('\r\n', '\n').slice(0, 300)}`);
    assert.deepEqual(got.err, b64(row.stderr_b64), `${row.name}: stderr differs`);
  }
});

test('the written files are byte-identical to what the reference wrote', () => {
  for (const row of CORPUS.rows) {
    const got = ANSWERS[row.name];
    assert.deepEqual(Object.keys(got.res.files).sort(), Object.keys(row.after).sort(),
      `${row.name}: a different set of files came back`);
    for (const name of Object.keys(row.after).sort()) {
      assert.deepEqual(b64(got.res.files[name]), b64(row.after[name]),
        `${row.name}/${name} differs BYTE-wise after the sync — a JSON-equal answer is not the `
        + 'same answer for a tool that edits committed files');
    }
  }
});

test('the verdict and the exit status are what the reference answered', () => {
  for (const row of CORPUS.rows) {
    const got = ANSWERS[row.name];
    assert.equal(got.res.changed, row.changed, `${row.name}: wrong \`changed\``);
    assert.equal(got.res.exit, row.exit, `${row.name}: wrong exit`);
  }
});

test('the tool actually does something in each direction', () => {
  // THE POSITIVE CONTROLS. Without them, twenty cases that all answered nothing would satisfy
  // the three replays above perfectly — recorded silence replayed as silence.
  const out = (name) => text(byName[name].stdout_b64);
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
