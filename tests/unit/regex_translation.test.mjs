// `toJsRegex` — the one place the CLI replayer TRANSLATES a pattern rather than copying it.
//
// `expect_re` values are Python regexes written against the reference and now handed to V8. Most
// of the 38 in the matrix use only constructs the two engines agree on; exactly ONE uses `\s`,
// and it matches an ordinary run of spaces, so the difference the translation exists for is
// never reached by the corpus. That is the shape of a helper nothing gates: exercised, and
// exercised only where it cannot be wrong.
//
// SO THE DIFFERENCE IS ASSERTED DIRECTLY. Python's `\s` and JavaScript's differ by five
// characters: Python counts U+001C..U+001F (the file/group/record/unit separators) and U+0085
// (NEL) as space and JavaScript does not, and JavaScript counts U+FEFF (the byte-order mark) as
// space and Python does not. A cell whose expected output carried one would silently match
// differently — turning an absolute assertion into a coin flip.
//
// EVERY ONE OF THEM IS WRITTEN AS AN ESCAPE, and that is not fastidiousness. An earlier draft of
// this file pasted the characters literally into a comment; U+2028 is a LINE TERMINATOR to
// JavaScript, so the comment ended mid-sentence and the file stopped parsing. The same property
// this file is about, one layer up.
import test from 'node:test';
import assert from 'node:assert/strict';

import { toJsRegex } from '../helpers/cli_golden.mjs';

// Python calls these space; JavaScript does not.
const PY_ONLY = ['\u001c', '\u001d', '\u001e', '\u001f', '\u0085'];
// JavaScript calls this space; Python does not.
const JS_ONLY = ['\ufeff'];

const name = (ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

test('the characters Python calls space and JavaScript does not', () => {
  for (const ch of PY_ONLY) {
    assert.ok(toJsRegex('a\\sb').test(`a${ch}b`), `${name(ch)}: the translation did not accept it`);
    // The control. Without it the assertion above would pass on an engine that already agreed,
    // and the translation would be untested rather than correct.
    assert.ok(!/a\sb/.test(`a${ch}b`),
      `${name(ch)}: V8's own \\s accepts it — the premise has changed`);
  }
});

test('the character JavaScript calls space and Python does not', () => {
  for (const ch of JS_ONLY) {
    assert.ok(!toJsRegex('a\\sb').test(`a${ch}b`), `${name(ch)}: the translation accepted it`);
    assert.ok(/a\sb/.test(`a${ch}b`),
      `${name(ch)}: V8's own \\s rejects it — the premise has changed`);
  }
});

test('the negated class is translated too', () => {
  // `\S` is the complement, and getting only `\s` right would leave every negated assertion
  // reading the OTHER definition — the failure mode `js/maintain/update.mjs` records for `WHITESPACE`.
  assert.ok(!toJsRegex('a\\Sb').test('a\u001cb'), 'U+001C is space to Python, so \\S must reject it');
  assert.ok(/a\Sb/.test('a\u001cb'), "V8's own \\S accepts it — the premise has changed");
});

test('the ordinary characters both engines agree on are unchanged', () => {
  for (const ch of [' ', '\t', '\n', '\r', '\f', '\v', '\u00a0', '\u3000']) {
    assert.ok(toJsRegex('a\\sb').test(`a${ch}b`), name(ch));
  }
  assert.ok(!toJsRegex('a\\sb').test('axb'));
});

// The one pattern in the matrix that reaches this helper, kept as a live case so the WIRING is
// proved and not only the translation.
test('the matrix pattern that uses the class still matches what it names', () => {
  const pat = '\\[version\\] source:\\s+[0-9a-f]{12}';
  assert.ok(toJsRegex(pat).test('[version] source:   c81317fdc842'));
  assert.ok(!toJsRegex(pat).test('[version] source:   nothexatall'));
});
