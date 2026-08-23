// THE REPLAYER'S ARGUMENT LAYER — the half of `tests/test_golden_sandbox.py` that is about
// `golden.py` rather than about the sandbox.
//
// A NARROWING FLAG NEEDS A WIRING TEST, and this project learned that by shipping one without.
// `--repeat` was added with its own gate, the gate was correct, and it was not connected: the
// flag reached neither side of the comparison and the suite stayed green. A flag that narrows
// what runs is a way to make a gate pass by running less of it, so each one is tested for what
// it selects AND for whether it announces itself to the orphan check.
//
// NOTHING HERE SPAWNS. 259 emits belong in the cells job; this runs on every push on both
// operating systems and costs milliseconds.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VERBATIM_CELLS, loadMatrix, parseArgs, selectCells,
} from '../golden.mjs';
import { cellId, argvFor } from '../helpers/golden.mjs';

const DOC = loadMatrix();

test('the exported matrix is the matrix', () => {
  assert.equal(DOC.cells.length, 261);
  assert.equal(DOC.deletion_cells.length, 9);
});

test('a cell id is theme/emit/footprint, with the optional axes appended', () => {
  assert.equal(cellId({ theme: 'neutral', emit: 'claude', footprint: 'lean' }),
    'neutral/claude/lean');
  assert.equal(cellId({ theme: 'neutral', emit: 'files', footprint: 'lean', posture: 'strict' }),
    'neutral/files/lean/strict');
  assert.equal(cellId({ label: 'bob/lean-to-full' }), 'bob/lean-to-full');
  // ⚠ THE FOURTH AXIS IS A LIST, AND AN EMPTY ONE IS AN ANSWER. `--doctrines none` is a real
  // configuration, so its id must differ from the default build's — a truthiness test would
  // give both `neutral/files/lean` and collide two cells into one.
  const base = { theme: 'neutral', emit: 'files', footprint: 'lean' };
  assert.equal(cellId({ ...base, doctrines: ['craft'] }), 'neutral/files/lean/craft');
  assert.equal(cellId({ ...base, doctrines: ['craft', 'rigor'] }), 'neutral/files/lean/craft+rigor');
  assert.equal(cellId({ ...base, doctrines: [] }), 'neutral/files/lean/none');
  assert.notEqual(cellId({ ...base, doctrines: [] }), cellId(base));
});

test('argv carries the optional axes only when the cell has them', () => {
  const base = { theme: 'neutral', emit: 'claude', footprint: 'lean' };
  assert.deepEqual(argvFor(base, '/o'),
    ['--theme', 'neutral', '--emit', 'claude', '--footprint', 'lean', '--out', '/o']);
  assert.ok(argvFor({ ...base, posture: 'strict' }, '/o').includes('--posture'));
  assert.ok(argvFor({ ...base, mode: 'foreman' }, '/o').includes('--mode'));
  assert.ok(!argvFor(base, '/o').includes('--posture'));
  // The same asymmetry on the way out: an empty list is spelled `none`, because the driver
  // refuses a bare `--doctrines ` as a usage error rather than reading it as "no packs".
  assert.deepEqual(argvFor({ ...base, doctrines: ['craft', 'rigor'] }, '/o').slice(-2),
    ['--doctrines', 'craft,rigor']);
  assert.deepEqual(argvFor({ ...base, doctrines: [] }, '/o').slice(-2), ['--doctrines', 'none']);
  assert.ok(!argvFor(base, '/o').includes('--doctrines'));
});

test('the matrix really exercises the doctrines axis in both directions', () => {
  // A cell added to the matrix is INERT until `cellId` and `argvFor` know the axis — the two
  // above are pure, so this is what proves the wiring reaches the corpus that replays it. Both
  // directions, because a narrowed build and an emptied one take different arms of the render.
  const doc = DOC.cells.filter((c) => c.doctrines !== undefined);
  assert.equal(doc.length, 2, 'the doctrines axis lost its cells');
  assert.deepEqual(doc.map((c) => c.doctrines).sort((a, b) => a.length - b.length),
    [[], ['craft']]);
  for (const c of doc) {
    assert.ok(argvFor(c, '/o').includes('--doctrines'), `${cellId(c)} does not reach the flag`);
  }
});

test('an unknown flag is refused rather than ignored', () => {
  assert.throws(() => parseArgs(['--nope']), /unknown flag/);
});

test('jobs refuses zero', () => {
  assert.throws(() => parseArgs(['--jobs', '0']), /--jobs must be positive/);
});

test('the two self-comparison modes are mutually exclusive', () => {
  assert.throws(() => parseArgs(['--idempotent', '--deletion']), /exclusive/);
});

test('every narrowing flag selects fewer cells, and none selects none', () => {
  const full = selectCells(DOC, parseArgs([]));
  assert.equal(full.length, 261);
  for (const argv of [['--quick'], ['--emits', 'claude'], ['--only', 'neutral/claude'],
    ['--limit', '5'], ['--shard', '0/4']]) {
    const got = selectCells(DOC, parseArgs(argv));
    // BOTH DIRECTIONS. A flag that selected everything would narrow nothing; one that selected
    // nothing would make the run vacuously green, which reads identically in a CI log.
    assert.ok(got.length < full.length && got.length > 0,
      `${argv.join(' ')} selected ${got.length} of ${full.length}`);
  }
});

test('--deletion selects the deletion matrix and nothing else', () => {
  assert.equal(selectCells(DOC, parseArgs(['--deletion'])).length, 9);
});

// TWO CORPUS TESTS STOOD HERE — one asserting every anchor cell really held verbatim text in
// the recording (the check that would have caught the reference's silently-empty first draft),
// one asserting the recording and the matrix had not drifted apart. Both asked a question about
// a committed recording, and the recordings were retired (docs/limits.md). The matrix itself is
// still gated above: `VERBATIM_CELLS` ids are still matrix ids, and `selectCells` still has to
// select them.
test('every anchor cell names a cell the matrix actually has', () => {
  const ids = new Set(DOC.cells.map(cellId));
  for (const cid of Object.keys(VERBATIM_CELLS)) {
    assert.ok(ids.has(cid), `${cid} is declared an anchor but is not a cell in the matrix`);
  }
});
