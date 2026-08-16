/**
 * The token-report script's borrowed Python primitives, replayed against a RECORDED corpus.
 *
 * SUCCESSOR TO `tests/test_token_report_parity.py`. ⚠ THIS ROW HAD A DEADLINE: its oracle is
 * `tests/fixtures/token_report_oracle.py`, which P4 deletes, and both the corpus and its answers
 * had to be taken while that file still existed. Recorded 2026-08-16 into
 * `tests/__snapshots__/token_report_primitives.json` — 266 rows over all fourteen exports.
 *
 * WHY THE SCRIPT REPRODUCES PYTHON AT ALL, since that reads like a contradiction in a de-Python
 * port: `src/skills/token-report/scripts/token_report.mjs` reads transcripts written by Python tooling
 * and must render the same numbers the same way — `f"{x:.1f}"`, `round()`'s banker's rounding,
 * `f"{n:,}"`, `len()` in code points, `json.dumps`' separators. It documents those semantics in
 * prose, which is why it is one of the two legitimate hits P4's no-python scan must not forbid.
 * After the cut this corpus IS the specification for them; there is nothing left to ask.
 *
 * TWO `pyFixed` DEFECTS REACHED A FULLY GREEN BEHAVIOURAL SUITE before the reference's primitive
 * corpus existed — the first because a written proof that `.1f` could not tie was false, the
 * second because the fix scaled by ten and manufactured a tie the real value never had. That is
 * the argument for a corpus over a seeded transcript: a transcript exercises the numbers it
 * happens to produce, which is not the same property.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { makeSandbox } from '../helpers/sandbox.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PROBE = path.join(ROOT, 'tests', 'fixtures', 'token_report_probe.mjs');
const SCRIPT = path.join(ROOT, 'src', 'skills', 'token-report', 'scripts', 'token_report.mjs');
const CORPUS = JSON.parse(readFileSync(
  path.join(ROOT, 'tests', '__snapshots__', 'token_report_primitives.json'), 'utf8'));

const sign = (n) => (n > 0 ? 1 : 0) - (n < 0 ? 1 : 0);

/** Run the probe over `[[fn, args], …]` and return its answers. */
function probe(calls) {
  const sb = makeSandbox('tokrep-');
  try {
    const payload = path.join(sb.path, 'corpus.json');
    writeFileSync(payload, JSON.stringify(calls), 'utf8');
    const r = spawnSync(process.execPath, [PROBE, payload],
      { cwd: ROOT, encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 26 });
    assert.equal(r.status, 0, `the probe failed: ${r.stderr}`);
    return JSON.parse(r.stdout);
  } finally {
    sb.cleanup();
  }
}

test('the recording is the shape it claims to be', () => {
  // THE POSITIVE CONTROLS FIRST — every assertion below is vacuous against an empty corpus.
  assert.ok(CORPUS.rows.length >= 250,
    `the primitive corpus has shrunk to ${CORPUS.rows.length}`);
  assert.match(CORPUS.recorded_with.python, /^\d+\.\d+$/,
    'a patch digit makes a corpus disagree with itself across two machines that both recorded '
    + 'it correctly');
  assert.equal(CORPUS.known_limits.length, 2);
  assert.ok(existsSync(PROBE), 'the probe is gone and nothing here can run');
});

test('the corpus reaches every exported primitive', () => {
  // A table nobody adds to is a table that stops covering the file. The required list is the
  // reference's own, frozen into the recording beside the rows it describes.
  const covered = new Set(CORPUS.rows.map((r) => r.fn));
  for (const required of CORPUS.exported_primitives) {
    assert.ok(covered.has(required), `${required} is exported but never driven`);
  }
  assert.equal(CORPUS.exported_primitives.length, 14);
});

test('every primitive answers what Python answered', () => {
  // THE COMPARISON BECAME A REPLAY. While the reference lived this asked CPython for each answer
  // and diffed; the answers are frozen now, which is strictly stronger than the comparison was —
  // two implementations that had both drifted the same way agreed with each other, and a
  // recording taken before the drift does not.
  const answers = probe(CORPUS.rows.map((r) => [r.fn, r.args]));
  assert.equal(answers.length, CORPUS.rows.length, 'the probe dropped cases');
  const signOnly = new Set(CORPUS.sign_only);
  const bad = [];
  for (let i = 0; i < CORPUS.rows.length; i += 1) {
    const { fn, args, want } = CORPUS.rows[i];
    // `pyStrCmp` and `comparePaths` return an ordering whose MAGNITUDE is unspecified in both
    // languages; the reference compared their SIGN and the recording says which rows those are.
    const have = signOnly.has(fn) ? sign(answers[i]) : answers[i];
    if (JSON.stringify(have) !== JSON.stringify(want)) {
      bad.push(`${fn}(${args.map((a) => JSON.stringify(a)).join(', ')}) -> `
        + `${JSON.stringify(have)}, python ${JSON.stringify(want)}`);
    }
  }
  assert.deepEqual(bad, [], `primitives disagree with what Python answered:\n  ${bad.join('\n  ')}`);
});

test('the known limits are still exactly these two, and still differ', () => {
  // THE INPUTS DELIBERATELY KEPT OUT OF THE CORPUS, asserted to still DIFFER. Excluding a case
  // and hiding it are the same act unless the exclusion is written down and checked. Both are
  // consequences of the int/float distinction that `JSON.parse` and a JS double cannot carry,
  // and neither is fixable without machinery far larger than the character count it would move.
  //
  // ⚠ COMPARED AS RENDERED TEXT, and the first draft got this wrong in the exact way the
  // reference warns about. Recording `pyInt`'s Python answer as a NUMBER round-tripped the
  // arbitrary-precision int through JSON into the very double the port produces, so the limit
  // read as CLOSED and the test failed against a port that was behaving correctly. "The JSON
  // transport of this very corpus cannot carry them either" — the recording says `python_text`.
  const answers = probe(CORPUS.known_limits.map((l) => [l.fn, l.args]));
  for (let i = 0; i < CORPUS.known_limits.length; i += 1) {
    const { fn, args, python_text: python, why } = CORPUS.known_limits[i];
    assert.notEqual(String(answers[i]), python,
      `${fn}(${JSON.stringify(args)}) now AGREES with Python — a declared limit has been `
      + `closed. Move the case into the corpus and delete this row.\n  the limit was: ${why}`);
  }
});

test('the script the corpus is about still ships', () => {
  // THE HALF OF `test_both_implementations_exist` THAT SURVIVES. Its other half asserted the
  // ORACLE exists — `tests/fixtures/token_report_oracle.py`, which P4 deletes — and that half
  // retires with it. What remains is the claim that matters after the cut: the script these 266
  // rows describe is on a PRODUCT path, not in the test tree, so the corpus is about something
  // a user actually gets.
  assert.ok(existsSync(SCRIPT),
    'src/skills/token-report/scripts/token_report.mjs is gone — this whole corpus is about nothing');
  const text = readFileSync(SCRIPT, 'utf8');
  for (const name of CORPUS.exported_primitives) {
    assert.ok(new RegExp(`\\b${name}\\b`).test(text),
      `${name} is in the corpus but no longer named by the script it is supposed to describe`);
  }
});
