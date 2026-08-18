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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  VERBATIM_CELLS, loadMatrix, narrowingReason, parseArgs, selectCells,
} from '../golden.mjs';
import { cellId, argvFor, PLATFORM_CORPUS } from '../helpers/golden.mjs';
import * as snapshotIo from '../helpers/snapshot_io.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOC = loadMatrix();

test('the exported matrix is the matrix', () => {
  assert.equal(DOC.cells.length, 259);
  assert.equal(DOC.deletion_cells.length, 9);
});

test('a cell id is theme/emit/footprint, with the optional axes appended', () => {
  assert.equal(cellId({ theme: 'neutral', emit: 'claude', footprint: 'lean' }),
    'neutral/claude/lean');
  assert.equal(cellId({ theme: 'neutral', emit: 'files', footprint: 'lean', posture: 'strict' }),
    'neutral/files/lean/strict');
  assert.equal(cellId({ label: 'bob/lean-to-full' }), 'bob/lean-to-full');
});

test('argv carries the optional axes only when the cell has them', () => {
  const base = { theme: 'neutral', emit: 'claude', footprint: 'lean' };
  assert.deepEqual(argvFor(base, '/o'),
    ['--theme', 'neutral', '--emit', 'claude', '--footprint', 'lean', '--out', '/o']);
  assert.ok(argvFor({ ...base, posture: 'strict' }, '/o').includes('--posture'));
  assert.ok(argvFor({ ...base, mode: 'foreman' }, '/o').includes('--mode'));
  assert.ok(!argvFor(base, '/o').includes('--posture'));
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

// `--against` replays a RECORDED corpus; `--idempotent`/`--deletion` compare a run against
// another run of the same implementation. Combining them would silently pick one.
test('a corpus replay cannot also be a self-comparison', () => {
  assert.throws(() => parseArgs(['--against', 'x', '--idempotent']), /have no corpus/);
  assert.throws(() => parseArgs(['--against', 'x', '--deletion']), /have no corpus/);
});

test('every narrowing flag selects fewer cells and announces itself', () => {
  const full = selectCells(DOC, parseArgs([]));
  assert.equal(full.length, 259);
  assert.equal(narrowingReason(parseArgs([])), null,
    'a full run must NOT skip the orphan check');

  for (const argv of [['--quick'], ['--emits', 'claude'], ['--only', 'neutral/claude'],
    ['--limit', '5'], ['--shard', '0/4']]) {
    const a = parseArgs(argv);
    const got = selectCells(DOC, a);
    assert.ok(got.length < full.length && got.length > 0,
      `${argv.join(' ')} selected ${got.length} of ${full.length}`);
    assert.ok(narrowingReason(a),
      `${argv.join(' ')} narrows the matrix and must skip the orphan check out loud — a corpus `
      + 'entry a narrowed run did not consume proves nothing, and a green narrowed replay reads '
      + 'exactly like a green full one in a CI log');
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
