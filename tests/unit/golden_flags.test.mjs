// THE REPLAYER'S ARGUMENT LAYER — the half of `tests/test_golden_sandbox.py` that is about
// `golden.py` rather than about the sandbox.
//
// A NARROWING FLAG NEEDS A WIRING TEST, and this project learned that by shipping one without.
// `--repeat` was added with its own gate, the gate was correct, and it was not connected: the
// flag reached neither side of the comparison and the suite stayed green. A flag that narrows
// what runs is a way to make a gate pass by running less of it, so each one is tested for what
// it selects AND for whether it announces itself to the orphan check.
//
// NOTHING HERE SPAWNS. 273 emits belong in the cells job; this runs on every push on both
// operating systems and costs milliseconds.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VERBATIM_CELLS, loadCliMatrix, loadMatrix, parseArgs, selectCells,
} from '../golden.mjs';
import { cellId, argvFor } from '../helpers/golden.mjs';

const DOC = loadMatrix();

// 14 themes x 9 emits x 2 footprints = 252, plus 11 cells on the extra axes (posture, mode,
// trust, doctrines), 10 on the kits axis (claude and opencode with the spring-boot kit, claude with
// `--kits none`, claude with both kits at once, opencode with the react kit; then the superpowers
// kit: on for claude, opencode and bob, and off for opencode and bob beside claude's `none`), and 16
// deletion cells (9 lean-to-full / theme-swap, 3 spring-boot on-to-off, then the superpowers kit
// on-to-off and off-to-on for claude and opencode).
test('the exported matrix is the matrix', () => {
  assert.equal(DOC.cells.length, 273);
  assert.equal(DOC.deletion_cells.length, 16);
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
  assert.deepEqual(argvFor({ ...base, trust: 'prudent' }, '/o').slice(-2), ['--trust', 'prudent']);
  assert.equal(cellId({ ...base, trust: 'aggressive' }), 'neutral/claude/lean/aggressive');
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

test('the matrix really exercises the kits axis, and an empty kit list is spelled none', () => {
  // The kits axis, written out: a cell naming a kit passes `--kits <name>`, a cell with an empty list
  // passes `--kits none` (the driver refuses an empty value as a usage error), and a cell with no
  // `kits` key passes no flag at all, so every older cell keeps the argv it always had.
  const base = { theme: 'neutral', emit: 'claude', footprint: 'lean' };
  assert.deepEqual(argvFor({ ...base, kits: ['spring-boot'] }, '/o').slice(-2), ['--kits', 'spring-boot']);
  assert.deepEqual(argvFor({ ...base, kits: [] }, '/o').slice(-2), ['--kits', 'none']);
  assert.ok(!argvFor(base, '/o').includes('--kits'));
  assert.equal(cellId({ ...base, kits: ['spring-boot'] }), 'neutral/claude/lean/kits:spring-boot');
  assert.notEqual(cellId({ ...base, kits: [] }), cellId(base));
  const kit = DOC.cells.filter((c) => c.kits !== undefined);
  assert.deepEqual(kit.map(cellId).sort(), ['neutral/claude/lean/kits:none',
    'neutral/claude/lean/kits:react+spring-boot', 'neutral/claude/lean/kits:spring-boot',
    'neutral/opencode/lean/kits:react', 'neutral/opencode/lean/kits:spring-boot',
    'neutral/bob/lean/kits:none', 'neutral/bob/lean/kits:superpowers', 'neutral/claude/lean/kits:superpowers',
    'neutral/opencode/lean/kits:none', 'neutral/opencode/lean/kits:superpowers'].sort());
  const del = DOC.deletion_cells.filter((c) => c.before?.kits?.length);
  assert.equal(del.length, 5, 'the kit on-to-off deletion cells are missing');
  // The superpowers kit both ways, on the two hosts a plugin can replace it on.
  assert.deepEqual(DOC.deletion_cells.filter((c) => /superpowers-kit/.test(c.label)).map((c) => c.label).sort(),
    ['claude/superpowers-kit-off-to-on', 'claude/superpowers-kit-on-to-off',
      'opencode/superpowers-kit-off-to-on', 'opencode/superpowers-kit-on-to-off']);
  assert.ok(del.some((c) => c.edit), 'no deletion cell edits a member before the kit goes off (R6)');
});

test('an unknown flag is refused rather than ignored', () => {
  assert.throws(() => parseArgs(['--nope']), /unknown flag/);
});

test('jobs refuses zero', () => {
  assert.throws(() => parseArgs(['--jobs', '0']), /--jobs must be positive/);
});

test('the three modes are mutually exclusive', () => {
  assert.throws(() => parseArgs(['--idempotent', '--deletion']), /exclusive/);
  assert.throws(() => parseArgs(['--cli', '--idempotent']), /exclusive/);
  assert.throws(() => parseArgs(['--cli', '--deletion']), /exclusive/);
});

test('--cli selects this platform\'s CLI matrix, and its narrowing flags narrow it', () => {
  // The CLI matrix is its own document; `--cli` must read it rather than the emit matrix, and
  // `--only`/`--shard`/`--limit` must apply to it (the emit-only flags do not).
  //
  // The count is written out per platform: 284 posix cells and 283 win32 cells. The halves share
  // all but the link/unlink cells (6 posix-only, 5 win32-only). The matrix lost 53 cells in
  // 2026-11 that an in-process or spawned unit test already covered, so a cell that disappears
  // now must be removed on purpose, with this row and this sentence changed in the same commit.
  const doc = loadCliMatrix();
  const all = selectCells(doc, parseArgs(['--cli']));
  assert.equal(all.length, doc.cells.length);
  assert.equal(all.length, process.platform === 'win32' ? 283 : 284, `${all.length} CLI cells`);
  for (const argv of [['--only', 'git-gate/'], ['--shard', '0/4'], ['--limit', '5']]) {
    const got = selectCells(doc, parseArgs(['--cli', ...argv]));
    assert.ok(got.length < all.length && got.length > 0, `${argv.join(' ')} selected ${got.length}`);
  }
});

test('every narrowing flag selects fewer cells, and none selects none', () => {
  const full = selectCells(DOC, parseArgs([]));
  assert.equal(full.length, 273);
  for (const argv of [['--quick'], ['--emits', 'claude'], ['--only', 'neutral/claude'],
    ['--limit', '5'], ['--shard', '0/4']]) {
    const got = selectCells(DOC, parseArgs(argv));
    // BOTH DIRECTIONS. A flag that selected everything would narrow nothing; one that selected
    // nothing would make the run vacuously green, which reads identically in a CI log.
    assert.ok(got.length < full.length && got.length > 0,
      `${argv.join(' ')} selected ${got.length} of ${full.length}`);
  }
});

test('--quick keeps the neutral theme only: 39 cells, which is what Windows CI re-emits', () => {
  // ci.yml runs `--idempotent --quick` on windows-latest. This row is the one home of the count:
  // the workflow comment points here rather than repeating the number.
  // 39 = the neutral theme's 9 emits x 2 footprints (18), plus the 11 cells on the extra axes and
  // the 10 kit cells, which are all neutral. A theme added to the matrix changes nothing here; an
  // axis cell added in another theme, or a neutral cell removed, moves the number.
  assert.equal(selectCells(DOC, parseArgs(['--idempotent', '--quick'])).length, 39);
  assert.ok(selectCells(DOC, parseArgs(['--idempotent', '--quick'])).every((c) => c.theme === 'neutral'));
});

test('--deletion selects the deletion matrix and nothing else', () => {
  assert.equal(selectCells(DOC, parseArgs(['--deletion'])).length, 16);
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
