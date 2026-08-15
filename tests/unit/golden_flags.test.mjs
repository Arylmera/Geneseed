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

// THE ANCHOR CELLS, and the reason they are checked against the CORPUS rather than against the
// matrix. Six cells keep their carrier file verbatim — everything else is hashes, and a corpus
// that can only say "a path moved" makes every regeneration a blind blessing. The reference's
// first draft named the ids reversed and the carriers as bare filenames, so a bare name never
// intersected the snapshot's sandbox-relative keys and the verbatim text silently recorded
// EMPTY for all six. Nothing failed. This is the check that would have caught it: the committed
// corpus must actually hold verbatim text at each declared path.
test('every anchor cell really carries verbatim text in the recorded corpus', () => {
  const dir = path.join(ROOT, 'tests', '__snapshots__', 'emit', PLATFORM_CORPUS);
  const ids = new Set(DOC.cells.map(cellId));
  for (const [cid, carriers] of Object.entries(VERBATIM_CELLS)) {
    assert.ok(ids.has(cid), `${cid} is not a cell in the matrix`);
    const rec = snapshotIo.read(dir, cid);
    assert.ok(rec, `${cid} has no recorded snapshot`);
    for (const carrier of carriers) {
      assert.ok(carrier in rec.paths, `${cid}: ${carrier} is not a path this cell produced`);
      assert.ok(rec.verbatim && carrier in rec.verbatim,
        `${cid}: ${carrier} is declared an anchor and was recorded as a hash only`);
      assert.ok(rec.verbatim[carrier].length > 0, `${cid}: ${carrier} recorded empty`);
    }
  }
});

test('the corpus this platform replays exists and is the whole matrix', () => {
  const dir = path.join(ROOT, 'tests', '__snapshots__', 'emit', PLATFORM_CORPUS);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, DOC.cells.length,
    `${files.length} recorded snapshots against ${DOC.cells.length} cells — the corpus and the `
    + 'matrix have drifted apart, which is exactly what the orphan check exists to report');
});
