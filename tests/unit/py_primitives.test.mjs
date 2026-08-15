// PYTHON NUMBER RENDERING — the bytes on users' disks, and after P4 the SPEC rather than a
// compatibility note.
//
// WHY THIS IS ABSOLUTE AND NOT A COMPARISON. While the reference lives,
// `tests/test_native_layer_parity.py::test_python_number_rendering_agrees` and
// `tests/test_opencode_extras_parity.py::test_json_container_rendering_agrees` ask CPython what
// it would have written and diff. When the reference goes there is nothing left to ask — and
// these functions are not "Python compatibility" any more, they ARE the definition of what
// Geneseed writes into a user's `opencode.json` and `settings.json`. A spec needs a corpus, not
// a second opinion.
//
// THIS FILE ALSO CLOSES `tests/mutate.mjs`'s M6, which was declared UNGATED for two phases. The
// hole was real and precisely stated: `1.0` and `1` are different values to Python's json
// round-trip and the same value to `JSON.parse`, and NO RECORDED CELL carries an integral float
// in its settings — so all 690 replay green whichever way the port behaves. The states worth
// fearing are the ones a clean fixture never reaches.
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseJson, jsonDumpsIndent, jsonDumpsCompact } from '../../js/lib/pyfs.mjs';

// A read-modify-write is what every settings merge does: parse the user's file, change one key,
// write it back. Every OTHER key must come back as the reference would have written it.
const roundTrip = (text) => jsonDumpsCompact(parseJson(text));

test('an integral float survives a read-modify-write as an integral float', () => {
  // `temperature: 1.0` is the real shape — a model setting a user hand-edits, which the
  // generator re-reads and re-writes on every emit. Collapsed to `1`, it is a different value
  // to the tools that consume it, and the damage is silent and permanent.
  assert.equal(roundTrip('{"temperature": 1.0}'), '{"temperature": 1.0}');
  assert.equal(roundTrip('{"a": 0.0, "b": -0.0, "c": 2.0}'), '{"a": 0.0, "b": -0.0, "c": 2.0}');
});

test('a true integer stays an integer', () => {
  // The other direction, and the reason the first test cannot be satisfied by appending `.0`
  // to everything: `1` must NOT become `1.0`.
  assert.equal(roundTrip('{"n": 1, "z": 0, "neg": -7}'), '{"n": 1, "z": 0, "neg": -7}');
});

// WHAT IS PRESERVED IS THE TYPE, NOT THE SPELLING, and this test was wrong on its first draft
// in the way §7 of the handoff warns about: it asserted `1e10` comes back as `1e10`, which is a
// property the REFERENCE does not have either. CPython answers `10000000000.0`, and a port
// "fixed" to satisfy my expectation would have diverged from the thing it reproduces.
//
// The mechanism, once read rather than guessed: `PyNumber` keeps the source text only to decide
// INT or FLOAT — whether it carried a `.` or an `e` — and the writer then renders `repr(float)`,
// which normalises the spelling. So the corpus below is CPython's own output, taken from
// `json.dumps(json.loads(...))`, not the input echoed back.
const CPYTHON = [
  ['0.1', '0.1'],
  ['1e10', '10000000000.0'],       // exponent expanded, and `.0` added
  ['1.5e-7', '1.5e-07'],           // and the exponent PADDED to two digits, unlike JS
  ['3.14159', '3.14159'],
  ['-2.5', '-2.5'],
];

test('a float renders as CPython renders it', () => {
  for (const [src, want] of CPYTHON) {
    assert.equal(roundTrip(`{"v": ${src}}`), `{"v": ${want}}`,
      `${src} did not render the way the reference renders it`);
  }
});

test('the indented writer preserves the same spellings', () => {
  // Both writers are used on user-owned files, so a fix in one that misses the other is a
  // defect that only shows up on whichever host takes the other path.
  assert.match(jsonDumpsIndent(parseJson('{"temperature": 1.0}')), /"temperature": 1\.0/);
  assert.match(jsonDumpsIndent(parseJson('{"n": 1}')), /"n": 1(?!\.)/);
});

test('numbers nested in containers keep their spelling too', () => {
  // The vacuity guard for the two tests above: a wrapper applied only at the top level would
  // pass them both and still corrupt every real settings file, where the numbers live inside
  // objects and arrays.
  assert.equal(roundTrip('{"o": {"t": 1.0}, "a": [1.0, 2, 3.5]}'),
    '{"o": {"t": 1.0}, "a": [1.0, 2, 3.5]}');
});
