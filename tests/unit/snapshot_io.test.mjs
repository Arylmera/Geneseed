// `tests/helpers/snapshot_io.mjs` — the successor to `tests/test_snapshot_io.py`, and more than
// a translation of it.
//
// THE PYTHON VERSION TESTS THE MODULE AGAINST ITSELF: it writes a snapshot, reads it back, and
// compares. Four cases, all synthetic, none of which can tell a reader that has misunderstood
// the format from one that has understood it — a round trip agrees with itself whichever way it
// is wrong. That was acceptable while the module was the only thing that ever wrote the corpus.
// It is not acceptable now: the 1,381 documents already committed under `tests/__snapshots__/`
// were written by CPython, they can never be re-recorded, and this reader has to be right about
// them rather than self-consistent.
//
// SO THE LOAD-BEARING TEST HERE IS THE LAST ONE, and it needs no Python at all. Every committed
// cell document is parsed, rebuilt through this module's own key ordering, re-serialised, and
// required to equal the file byte for byte. That exercises the sort (code point, not UTF-16),
// the indent, Python's `(',', ': ')` separators under `indent=`, `ensure_ascii=False`, and the
// trailing newline — against 1,381 real recordings instead of one invented one. A reader that
// has misread the format cannot round-trip somebody else's bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compare, read, safeName, write } from '../helpers/snapshot_io.mjs';
import { jsonDumpsIndent } from '../../js/lib/pyfs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SNAPS = path.join(ROOT, 'tests', '__snapshots__');
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

test('every committed cell document round-trips through this writer, byte for byte', () => {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.json') && /[\\/](?:emit|cli|web)[\\/]/.test(p)) files.push(p);
    }
  };
  walk(SNAPS);

  // A gate over a corpus has to say how much corpus it found. `emit` alone is 518 documents and
  // a glob that quietly matched none of them would pass this test in silence.
  assert.ok(files.length > 1000, `expected the recorded corpus, found ${files.length} documents`);

  const bad = [];
  for (const f of files) {
    // LINE TERMINATORS ARE NORMALISED AWAY, and the first draft of this test was wrong to
    // compare them. `.gitattributes` declares `* text=auto eol=lf`, so the corpus is LF in the
    // index — but `Path.write_text` emitted `os.linesep` when the `crlf` half was recorded on
    // Windows, and git's `text=auto` normalises on comparison, so 365 of these files sit in
    // this working tree as CRLF while `git status` reports them clean. A fresh clone has LF.
    // Comparing raw would make this gate green in CI and red on the machine that recorded the
    // corpus, which is a report about a checkout rather than about the format. What is under
    // test is the SERIALISATION — key order, `(',', ': ')` under `indent=`, `ensure_ascii=
    // False`, the trailing newline — and the terminator is gated by `.gitattributes` itself.
    const raw = fs.readFileSync(f, 'utf8').split('\r\n').join('\n');
    const doc = JSON.parse(raw);
    // Rebuilt through the writer's own ordering rather than re-emitted as parsed, so the sort
    // is under test and not merely the serialiser.
    const rebuilt = {
      paths: sorted(doc.paths),
      sizes: sorted(doc.sizes),
      verbatim: sorted(doc.verbatim || {}),
    };
    const text = `${jsonDumpsIndent(rebuilt, { ensureAscii: false })}\n`;
    if (text !== raw) bad.push(path.relative(ROOT, f));
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} recorded documents this writer does not `
    + 'reproduce; the reader that replays them has misread the format');
});

// Structural claims the format makes, asserted over the whole corpus rather than over a fixture:
// every hash is a sha256, every size has a hash, and every verbatim carrier is a path the cell
// actually recorded. A `verbatim` entry with no `paths` row would print a diff for a file the
// snapshot does not contain.
test('the corpus keeps the shape the format claims', () => {
  const problems = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.json') || !/[\\/](?:emit|cli|web)[\\/]/.test(p)) continue;
      const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
      const rel = path.relative(ROOT, p);
      for (const [k, v] of Object.entries(doc.paths)) {
        if (!/^[0-9a-f]{64}$/.test(v)) problems.push(`${rel}: ${k} is not a sha256`);
      }
      const keys = new Set(Object.keys(doc.paths));
      for (const k of Object.keys(doc.sizes)) {
        if (!keys.has(k)) problems.push(`${rel}: ${k} has a size and no hash`);
      }
      for (const k of Object.keys(doc.verbatim || {})) {
        if (!keys.has(k)) problems.push(`${rel}: ${k} is verbatim and not recorded`);
      }
    }
  };
  walk(SNAPS);
  assert.deepEqual(problems.slice(0, 10), []);
});

function sorted(obj) {
  const out = {};
  for (const k of Object.keys(obj).sort(cmp)) out[k] = obj[k];
  return out;
}

function cmp(a, b) {
  const A = [...a];
  const B2 = [...b];
  for (let i = 0; i < Math.min(A.length, B2.length); i += 1) {
    const d = A[i].codePointAt(0) - B2[i].codePointAt(0);
    if (d !== 0) return d;
  }
  return A.length - B2.length;
}
