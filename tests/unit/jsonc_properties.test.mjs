/**
 * Properties of the settings round trip, over generated JSON rather than written rows.
 *
 * WHY PROPERTIES HERE, when every other table in tests/ is written out (ADR 0003). The written
 * table in `settings_jsonc.test.mjs` pins the shapes someone thought of: a `//` inside a
 * string, a trailing comma, a block comment. These state the invariant those rows are samples
 * of — whatever the user's JSON, a comment or a trailing comma added anywhere a human would put
 * one changes no value, and writing the result back is stable — and let fast-check look for the
 * shape nobody thought of. `readJsonc` runs on every emit over a file the user co-owns, and a
 * wrong answer there is not a crash, it is a silently rewritten config.
 *
 * The expected values are still not recorded: each property compares the product against
 * itself on a transformed input. A failure prints the seed and the shrunk counterexample, which
 * is the row to add to the written table.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';

import { readJsonc } from '../../js/hosts/settings.mjs';
import { jsonDumpsCompact, parseJson } from '../../js/lib/json.mjs';

// What a value reads as, through the writer every merge uses — so `1.0` and `1` stay distinct,
// exactly as they must on disk. Non-ASCII is escaped by default, which is the shipped setting.
const canon = (text) => jsonDumpsCompact(parseJson(text));

// Pretty-printed, because that is what a hand-edited settings.json looks like, and because
// `JSON.stringify(v, null, 2)` never puts a raw newline inside a string: every `\n` below is
// between tokens, so inserting a comment there is always outside a string.
const pretty = fc.jsonValue().map((v) => JSON.stringify(v, null, 2));

test('readJsonc reads plain JSON exactly as parseJson does, and reports no comments', () => {
  fc.assert(fc.property(pretty, (text) => {
    const [data, hadComments] = readJsonc(text);
    assert.equal(hadComments, false);
    assert.equal(jsonDumpsCompact(data), canon(text));
  }), { numRuns: 300 });
});

test('a line comment at the end of any line changes no value', () => {
  fc.assert(fc.property(pretty, fc.string({ unit: 'grapheme-ascii' }), (text, note) => {
    const clean = note.replace(/[\r\n]/g, '');
    const commented = text.replaceAll('\n', ` // ${clean}\n`) + ` // ${clean}`;
    const [data, hadComments] = readJsonc(commented);
    assert.equal(hadComments, true);
    assert.equal(jsonDumpsCompact(data), canon(text));
  }), { numRuns: 300 });
});

test('a block comment between any two lines changes no value', () => {
  fc.assert(fc.property(pretty, fc.string({ unit: 'grapheme-ascii' }), (text, note) => {
    const body = note.replaceAll('*/', '* /');
    const commented = `/* ${body} */\n` + text.replaceAll('\n', `\n/* ${body} */`);
    const [data] = readJsonc(commented);
    assert.equal(jsonDumpsCompact(data), canon(text));
  }), { numRuns: 300 });
});

test('a trailing comma before any closing bracket changes no value', () => {
  // Pretty JSON closes a non-empty container on its own line, after a value — the one place a
  // human leaves a trailing comma. An empty `{}`/`[]` is printed inline and gets none.
  fc.assert(fc.property(pretty, (text) => {
    const trailing = text.replace(/\n(\s*[}\]])/g, ',\n$1');
    const [data] = readJsonc(trailing);
    assert.equal(jsonDumpsCompact(data), canon(text));
  }), { numRuns: 300 });
});

test('writing back what was read is stable: a second merge changes no byte', () => {
  // Every emit reads the user's file and writes it back; if read∘write were not idempotent, each
  // rebuild would drift the file a little further from what the user wrote.
  fc.assert(fc.property(pretty, (text) => {
    const once = canon(text);
    assert.equal(canon(once), once);
  }), { numRuns: 300 });
});
