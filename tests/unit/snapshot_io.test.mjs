// `tests/helpers/snapshot_io.mjs` — the successor to `tests/test_snapshot_io.py`, and more than
// a translation of it.
//
// THE PYTHON VERSION TESTS THE MODULE AGAINST ITSELF: it writes a snapshot, reads it back, and
// compares. None of those cases can tell a reader that has misunderstood the format from one
// that has understood it — a round trip agrees with itself whichever way it is wrong.
//
// TWO TESTS USED TO ANSWER THAT, by reading the 1,381 documents CPython had committed under
// `tests/__snapshots__/` and requiring this writer to reproduce each byte for byte. Both went
// with the recordings when the emit, cli and web corpora were retired (`docs/limits.md`), and
// the second of them had already become the vacuous kind of green the retirement was about: its
// walk filtered on `emit|cli|web`, so with those directories gone it found nothing, reported no
// problems, and passed. What is left below is the self-consistent tier, honestly labelled — the
// second opinion on the format is gone, and `write` now has one caller's word for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { compare, read, safeName, write } from '../helpers/snapshot_io.mjs';

const B = (s) => Buffer.from(s, 'utf8');
const tmp = () => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'snapio-'));

test('identical snapshots compare clean', () => {
  const dir = tmp();
  const snap = new Map([['a/b.md', B('hello\n')], ['<stdout>', B('ok\n')], ['<exit>', B('0')]]);
  write(dir, 'cell-1', snap, { verbatim: new Set(['<stdout>', '<exit>']) });
  assert.deepEqual(compare(read(dir, 'cell-1'), snap), []);
});

test('a changed byte is reported by path', () => {
  const dir = tmp();
  write(dir, 'cell-1', new Map([['a/b.md', B('hello\n')]]), { verbatim: new Set() });
  const problems = compare(read(dir, 'cell-1'), new Map([['a/b.md', B('HELLO\n')]]));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /a\/b\.md/);
});

test('a missing and an extra path are both reported', () => {
  const dir = tmp();
  write(dir, 'c', new Map([['kept', B('1')], ['gone', B('2')]]), { verbatim: new Set() });
  const problems = compare(read(dir, 'c'), new Map([['kept', B('1')], ['new', B('3')]]));
  assert.equal(problems.length, 2);
  assert.ok(problems.some((p) => p.includes('gone')));
  assert.ok(problems.some((p) => p.includes('new')));
});

test('an unrecorded cell reads as null', () => {
  assert.equal(read(tmp(), 'never-recorded'), null);
});

// A CHANGED file whose name is in `verbatim` must print BOTH texts through `repr()`, because the
// difference this corpus reports most often is whitespace — a trailing `\r`, a lost newline —
// and unescaped it is invisible in a terminal and in a pull request alike.
test('a changed verbatim carrier shows both texts, escaped', () => {
  const dir = tmp();
  write(dir, 'c', new Map([['<stdout>', B('done\n')]]), { verbatim: new Set(['<stdout>']) });
  const problems = compare(read(dir, 'c'), new Map([['<stdout>', B('done\r\n')]]));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /recorded: 'done\\n'/);
  assert.match(problems[0], /live: {5}'done\\r\\n'/);
});

test('a cell id becomes one flat filename, reversible by eye', () => {
  assert.equal(safeName('doctor/a-token:2'), 'doctor__a-token-2');
});

// The refusal, and it is a real hazard rather than a hypothetical: V8 hoists integer-like keys
// to the front of an object regardless of insertion order, so a snapshot containing a file
// literally named `0` would serialise out of sorted order and silently stop matching the
// reference's document. Refusing beats emitting bytes that disagree.
test('an integer-like key is refused rather than silently reordered', () => {
  assert.throws(
    () => write(tmp(), 'c', new Map([['0', B('x')], ['a', B('y')]]), { verbatim: new Set() }),
    /integer-like/,
  );
});



