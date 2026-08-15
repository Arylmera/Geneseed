// THE EMIT CORPUS, REPLAYED — with no Python involved.
//
// `tests/golden.py --against tests/__snapshots__/emit --new "node bin/geneseed.mjs"` is the
// step in CI's `cells` job that survives P4 in spirit and dies in fact: it is a Python program.
// This is the same replay, driven from Node, reading the same recorded bytes and the same
// exported matrix.
//
// WHAT IT CANNOT DO, deliberately: `--record` (the oracle is gone, and a corpus re-blessed from
// the port proves determinism rather than regression) and `--ref` (a comparison needs a second
// implementation). What it does do is the three gates that still mean something with one
// runtime: replay the recorded corpus, re-emit into the same tree and require the bytes to be
// identical, and emit configuration A then B and require the result to equal a fresh B.
//
// A SEPARATE SCRIPT RATHER THAN A `*.test.mjs`, because 259 cells is minutes of wall clock and
// `node --test "tests/**/*.test.mjs"` runs on every push on two operating systems. The pure
// halves — the normaliser, the destamp, the corpus stamps — are gated in `tests/unit/` where
// they cost nothing. This is what the cells job runs.
//
// USAGE:
//   node tests/golden.mjs --against tests/__snapshots__/emit
//   node tests/golden.mjs --idempotent
//   node tests/golden.mjs --deletion
//   ... --gen "node bin/geneseed.mjs" --only neutral/claude --jobs 8 --limit 5
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  PLATFORM_CORPUS, ROOT, VERBATIM_CELLS, cellId, corpusNormalise, orphanCheck, runCell,
} from './helpers/golden.mjs';
import * as snapshotIo from './helpers/snapshot_io.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MATRIX = path.join(HERE, 'helpers', 'matrix');

function loadMatrix() {
  // The two halves were MEASURED to be byte-identical (`test_matrix_export.py`), so either
  // serves. This host's own is read first so that a future divergence shows up as a real
  // difference in this run rather than as a silent preference.
  for (const plat of [process.platform === 'win32' ? 'win32' : 'posix', 'win32', 'posix']) {
    const f = path.join(MATRIX, `emit.${plat}.json`);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  throw new Error(`no exported emit matrix under ${MATRIX} — run tests/export_matrix.py`);
}

function parseArgs(argv) {
  const a = { jobs: Math.min(8, os.cpus().length), limit: 0, gen: 'node bin/geneseed.mjs' };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--against') a.against = argv[++i];
    else if (k === '--gen') a.gen = argv[++i];
    else if (k === '--only') a.only = argv[++i];
    else if (k === '--emits') a.emits = argv[++i];
    else if (k === '--jobs') a.jobs = Number(argv[++i]);
    else if (k === '--limit') a.limit = Number(argv[++i]);
    else if (k === '--quick') a.quick = true;
    else if (k === '--idempotent') a.idempotent = true;
    else if (k === '--deletion') a.deletion = true;
    else if (k === '--shard') a.shard = argv[++i];
    else throw new Error(`unknown flag ${k}`);
  }
  if (!(a.jobs > 0)) throw new Error('--jobs must be positive');
  if (a.idempotent && a.deletion) throw new Error('--idempotent and --deletion are exclusive');
  if (a.against && (a.idempotent || a.deletion)) {
    throw new Error('--against replays the recorded corpus; --idempotent/--deletion compare a '
      + 'run against another run of the same implementation and have no corpus');
  }
  return a;
}

// The narrowing reason, for `orphanCheck`. A corpus entry a NARROWED run did not consume proves
// nothing, so the check is skipped — announced, never silent.
function narrowingReason(a) {
  const why = [];
  if (a.only) why.push(`--only ${a.only}`);
  if (a.emits) why.push(`--emits ${a.emits}`);
  if (a.quick) why.push('--quick');
  if (a.limit) why.push(`--limit ${a.limit}`);
  if (a.shard) why.push(`--shard ${a.shard}`);
  return why.length ? why.join(' + ') : null;
}

function selectCells(doc, a) {
  let cells = a.deletion ? doc.deletion_cells : doc.cells;
  if (a.quick) cells = cells.filter((c) => c.theme === 'neutral');
  if (a.emits) {
    const want = new Set(a.emits.split(','));
    cells = cells.filter((c) => want.has(c.emit));
  }
  if (a.only) cells = cells.filter((c) => cellId(c).startsWith(a.only));
  if (a.shard) {
    const [i, n] = a.shard.split('/').map(Number);
    cells = cells.filter((_, idx) => idx % n === i);
  }
  if (a.limit) cells = cells.slice(0, a.limit);
  return cells;
}

function main(argv) {
  const a = parseArgs(argv);
  const gen = a.gen.split(' ').filter(Boolean);
  const doc = loadMatrix();
  const cells = selectCells(doc, a);
  if (cells.length === 0) throw new Error('the selection is empty — nothing would be checked');

  const against = a.against ? path.join(a.against, PLATFORM_CORPUS) : null;
  if (against && !fs.existsSync(against)) {
    throw new Error(`no recorded corpus at ${against} for this platform`);
  }
  const mode = against ? `against ${path.relative(ROOT, against)}`
    : (a.idempotent ? 'idempotent' : (a.deletion ? 'deletion' : 'run only'));
  console.log(`[golden] ${cells.length} cells, ${mode}, gen=${a.gen}`);

  const failures = [];
  let done = 0;
  for (const cell of cells) {
    const cid = cellId(cell);
    const problems = against ? replay(gen, cell, cid, against)
      : (a.idempotent ? idempotent(gen, cell)
        : (a.deletion ? deletion(gen, cell) : justRun(gen, cell)));
    if (problems.length) failures.push(`  ${cid}\n${problems.join('\n')}`);
    done += 1;
    if (done % 25 === 0) console.log(`[golden] ${done}/${cells.length}`);
  }

  if (against) {
    const orph = orphanCheck(against, new Set(cells.map(cellId)), narrowingReason(a));
    if (orph && orph.skipped) console.log(`[corpus] ${orph.skipped}`);
    else if (orph) {
      failures.push(`  CORPUS ORPHANS: ${orph.orphans.length} recorded snapshot(s) in `
        + `${against} were not consumed by this run — the matrix has shrunk away from its own `
        + `corpus, and the replay would otherwise pass over the gap:\n`
        + orph.orphans.slice(0, 10).map((n) => `    ${n}`).join('\n')
        + (orph.orphans.length > 10 ? `\n    ... and ${orph.orphans.length - 10} more` : ''));
    }
  }

  if (failures.length) {
    console.error(`\n[golden] ${failures.length} FAILED of ${cells.length}\n`);
    console.error(failures.join('\n\n'));
    return 1;
  }
  console.log(`[golden] ${cells.length} cells ... ok`);
  return 0;
}

function replay(gen, cell, cid, against) {
  const snap = runCell(gen, cell);
  if (typeof snap === 'string') return [`    RAN BADLY: ${snap}`];
  const recorded = snapshotIo.read(against, cid);
  if (recorded === null) {
    return [`    NO RECORDED SNAPSHOT in ${against} — a cell that ran with nothing to compare `
      + 'against is a hole, not a pass'];
  }
  return snapshotIo.compare(recorded, corpusNormalise(snap));
}

// THE STREAMS ARE ONLY COMPARABLE WHEN BOTH SIDES RAN THE SAME NUMBER OF TIMES. Emit two
// legitimately says different things from emit one — it warns about files it now finds already
// there — so both flags below drop them rather than reporting a difference that is the POINT of
// the flag. Missing this was the first draft's whole `--deletion` failure list.
function dropStreams(...snaps) {
  for (const s of snaps) { s.delete('<stdout>'); s.delete('<stderr>'); }
}

// Re-emit the SAME configuration into the same tree. Every byte must be identical: this is the
// path real users are on from their second build onwards.
function idempotent(gen, cell) {
  const once = runCell(gen, cell, { repeat: 1 });
  if (typeof once === 'string') return [`    RAN BADLY: ${once}`];
  const twice = runCell(gen, cell, { repeat: 2 });
  if (typeof twice === 'string') return [`    RAN BADLY (repeat): ${twice}`];
  dropStreams(once, twice);
  return diffMaps(once, twice, 'first emit', 're-emit');
}

// Emit configuration A, then B onto A's tree, and require the result to equal a FRESH emit of
// B. A working prune makes those byte-identical; a deleted prune leaves A's extra files behind,
// and a prune widened past `old_owned - owned` deletes files B owns and still wants.
function deletion(gen, cell) {
  const overlaid = runCell(gen, cell);
  if (typeof overlaid === 'string') return [`    RAN BADLY: ${overlaid}`];
  const { before, ...fresh } = cell;
  const clean = runCell(gen, fresh);
  if (typeof clean === 'string') return [`    RAN BADLY (fresh): ${clean}`];
  dropStreams(clean, overlaid);

  // THE SOVEREIGN WRITE-ONCE SEEDS. A deletion cell switches the theme under a tree that
  // already has one, and the agent's own spaces are seeded ONCE and never re-rendered by
  // design — so they keep the pre-switch vocabulary while a fresh emit renders the new one.
  // That is the contract, not a prune failure.
  //
  // AND A CELL WHOSE CARVE-OUT CATCHES NOTHING FAILS. A normaliser that has stopped excusing
  // anything is hiding whatever it would excuse next, and this is the direction a carve-out
  // written as a plain filter never checks.
  const problems = diffMaps(clean, overlaid, 'fresh emit', 'after the prune');
  const sov = cell.sovereign || [];
  const excused = problems.filter((p) => sov.some((s) => p.includes(s)));
  if (sov.length && excused.length === 0) {
    return [`    the sovereign carve-out ${JSON.stringify(sov)} excuses nothing here — no file `
      + 'kept its pre-switch text, so the carve-out is hiding whatever it would excuse next '
      + 'and must be removed'];
  }
  return problems.filter((p) => !excused.includes(p));
}

function justRun(gen, cell) {
  const snap = runCell(gen, cell);
  return typeof snap === 'string' ? [`    RAN BADLY: ${snap}`] : [];
}

function diffMaps(a, b, aName, bName) {
  const out = [];
  for (const k of [...a.keys()].sort()) {
    if (!b.has(k)) out.push(`    MISSING ${k} (in ${aName}, not in ${bName})`);
  }
  for (const k of [...b.keys()].sort()) {
    if (!a.has(k)) out.push(`    EXTRA   ${k} (in ${bName}, not in ${aName})`);
  }
  for (const k of [...a.keys()].sort()) {
    if (!b.has(k) || a.get(k).equals(b.get(k))) continue;
    out.push(`    CHANGED ${k} (${a.get(k).length} -> ${b.get(k).length} bytes)`);
  }
  return out;
}

// Kept exported so `tests/unit/golden_flags.test.mjs` can drive the argument layer without
// spawning 259 emits — the same split `test_golden_sandbox.py`'s FlagWiringTests relies on.
export { parseArgs, selectCells, narrowingReason, loadMatrix, VERBATIM_CELLS };

if (import.meta.url === `file://${process.argv[1].split(path.sep).join('/')}`
  || process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(`[golden] ${e.message}`);
    process.exit(2);
  }
}
