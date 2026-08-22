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

import { parseJson, jsonDumpsIndent, jsonDumpsCompact } from '../../js/lib/json.mjs';

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
// The mechanism, once read rather than guessed: `JsonNumber` keeps the source text only to decide
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

// CONTAINER RENDERING — the other half of the same spec, and the successor to
// `tests/test_opencode_extras_parity.py::test_json_container_rendering_agrees` plus the corpus
// gate beside it (`test_the_corpus_reaches_the_shapes_the_emitted_files_do_not`). Every answer
// below was taken from CPython on 2026-08-16.
//
// THE FIXTURES ARE BUILT THROUGH `parseJson`, NOT AS OBJECT LITERALS, and that is not style: a
// bare JS number makes `formatValue` THROW on purpose, because `JSON.parse` has already collapsed
// int 1 and float 1.0 by the time the literal exists. Measured while writing this — the first
// draft threw.
// ⚠ AND `sortKeys` IS AN OPTION, NOT THE DEFAULT — the first draft of this table asserted
// sorted output from a plain `jsonDumpsCompact` and went red, which is §7's standing trap
// reached from the fixture side: I had measured `json.dumps(o, sort_keys=True)` and then held
// the port to a property its own default does not have. Both columns below are CPython's, taken
// separately: `json.dumps(o)` preserves insertion order and `json.dumps(o, sort_keys=True)` does
// not, and `js/hosts/settings.mjs` has call sites of each.
const CONTAINERS = [
  // [source, compact (insertion order), sorted]
  ['{}', '{}', '{}'],
  ['[]', '[]', '[]'],
  ['{"b": 1, "a": 2}', '{"b": 1, "a": 2}', '{"a": 2, "b": 1}'],
  // sort_keys RECURSES. A sort applied only at the top level passes the row above and fails
  // this one, and an already-sorted corpus could not tell either from a missing sort.
  ['{"z": {"y": 1, "x": 2}, "a": [1, {"q": 1, "p": 2}]}',
    '{"z": {"y": 1, "x": 2}, "a": [1, {"q": 1, "p": 2}]}',
    '{"a": [1, {"p": 2, "q": 1}], "z": {"x": 2, "y": 1}}'],
  // ensure_ascii, including a character OUTSIDE the BMP: CPython emits a surrogate PAIR.
  ['{"s": "a — b", "e": "😀"}',
    '{"s": "a \\u2014 b", "e": "\\ud83d\\ude00"}',
    '{"e": "\\ud83d\\ude00", "s": "a \\u2014 b"}'],
  // Empty and nested containers, which the emitted themes — flat string/int maps — never carry.
  ['{"n": [[], {}, [{}]]}', '{"n": [[], {}, [{}]]}', '{"n": [[], {}, [{}]]}'],
];

test('containers render as CPython renders them', () => {
  for (const [src, compact, sorted] of CONTAINERS) {
    assert.equal(jsonDumpsCompact(parseJson(src)), compact,
      `${src} did not render the way json.dumps renders it`);
    assert.equal(jsonDumpsCompact(parseJson(src), { sortKeys: true }), sorted,
      `${src} did not render the way json.dumps(sort_keys=True) renders it`);
  }
  // The control that says the two columns are not the same function twice.
  assert.ok(CONTAINERS.some(([, c, s]) => c !== s),
    'no row where sorting changes the answer, so the sortKeys column asserts nothing');
});

test('the container corpus reaches the shapes the emitted files do not', () => {
  // THE GATE ON THE CORPUS, carried over in intent from the reference. The emitted themes are
  // flat string/int maps; if this corpus decayed to that, the separator and sort questions it
  // exists to answer would go untested while every row still passed.
  const parsed = CONTAINERS.map(([src]) => parseJson(src));
  const isFlat = (o) => o !== null && typeof o === 'object' && !Array.isArray(o)
    && Object.values(o).every((v) => v === null || typeof v !== 'object');
  assert.ok(parsed.filter(isFlat).length < parsed.length, 'the corpus is all flat maps');
  assert.ok(parsed.some((o) => Object.keys(o).length === 0), 'no empty container');
  assert.ok(parsed.some((o) => Object.values(o).some((v) => v && typeof v === 'object')),
    'no nested container');
  assert.ok(CONTAINERS.some(([src]) => [...src].some((c) => c.codePointAt(0) > 126)),
    'no non-ASCII string');
  // The two-level out-of-order map, named rather than merely present.
  assert.ok(CONTAINERS.some(([, , sorted]) => sorted.includes('{"p": 2, "q": 1}')),
    'no map whose keys are out of order at TWO levels — sort_keys is recursive, and an '
    + 'already-sorted corpus cannot tell a working sort from a missing one');
});

test('numbers nested in containers keep their spelling too', () => {
  // The vacuity guard for the two tests above: a wrapper applied only at the top level would
  // pass them both and still corrupt every real settings file, where the numbers live inside
  // objects and arrays.
  assert.equal(roundTrip('{"o": {"t": 1.0}, "a": [1.0, 2, 3.5]}'),
    '{"o": {"t": 1.0}, "a": [1.0, 2, 3.5]}');
});
