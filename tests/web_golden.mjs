// THE WEB CONSOLE CORPUS, REPLAYED — with no Python involved.
//
// 114 cells, each a request script over one reused connection against a daemon started in a
// fresh sandbox. The absolute tier runs FIRST against the candidate, for the reason it does in
// the CLI replayer and more sharply: two servers that both stopped enforcing the CSRF token
// would agree in every guard cell, forever.
//
// BOTH ENTRIES, because a second driver does not inherit the first's proof. `js/web/server.mjs`
// is the daemon's own entry and `bin/geneseed-cli.mjs web` is the CLI's, and the corpus replay
// is where that matters most — it is the only one of the two gates that survives P4.
//
// USAGE:
//   node tests/web_golden.mjs --against tests/__snapshots__/web
//   ... --cli "node js/web/server.mjs" --only activity/ --first 5
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLATFORM_CORPUS, ROOT, corpusNormalise, orphanCheck } from './helpers/golden.mjs';
import { checkExpectations, runCell, webCorpusNormalise } from './helpers/web_golden.mjs';
import { resolveCli } from './cli_golden.mjs';
import * as snapshotIo from './helpers/snapshot_io.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MATRIX = path.join(HERE, 'helpers', 'matrix');

export function loadMatrix() {
  // PER-PLATFORM: `_MEM_CASE_FOLDED` orders the catalog by the host's case-folding rule, so two
  // cells carry a different `expect_re` on each. Measured and declared in
  // `tests/test_matrix_export.py`, which is why reading the wrong half would be a silent pass
  // rather than a loud one.
  const plat = process.platform === 'win32' ? 'win32' : 'posix';
  const f = path.join(MATRIX, `web.${plat}.json`);
  if (!fs.existsSync(f)) throw new Error(`no exported web matrix at ${f}`);
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

export function parseArgs(argv) {
  const a = { limit: 12, cli: 'node js/web/server.mjs' };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--against') a.against = argv[++i];
    else if (k === '--cli') a.cli = argv[++i];
    else if (k === '--only') a.only = argv[++i];
    else if (k === '--first') a.first = Number(argv[++i]);
    else if (k === '--limit') a.limit = Number(argv[++i]);
    else throw new Error(`unknown flag ${k}`);
  }
  if (!a.against) throw new Error('--against is required: this replayer has no other mode');
  return a;
}

export function narrowingReason(a) {
  const why = [];
  if (a.only) why.push(`--only ${a.only}`);
  if (a.first) why.push(`--first ${a.first}`);
  return why.length ? why.join(' + ') : null;
}

export function selectCells(doc, a) {
  let cells = doc.cells;
  if (a.only) cells = cells.filter((c) => c.id.startsWith(a.only));
  if (a.first) cells = cells.slice(0, a.first);
  return cells;
}

async function main(argv) {
  const a = parseArgs(argv);
  const doc = loadMatrix();
  const cells = selectCells(doc, a);
  if (cells.length === 0) throw new Error('the selection is empty — nothing would be checked');

  const against = path.join(a.against, PLATFORM_CORPUS);
  if (!fs.existsSync(against)) throw new Error(`no recorded corpus at ${against}`);
  const cli = resolveCli(a.cli);
  console.log(`[web-golden] ${cells.length} cells, against ${path.relative(ROOT, against)}, `
    + `cli=${a.cli}`);

  const failures = [];
  let done = 0;
  for (const cell of cells) {
    // THE SHARED CLOCK, one per cell. The recorded bodies carry `<NOW>`/`<OLDER>`/`<STALE>`
    // tags computed from whatever second the recording used, so any second works here as long
    // as the seeding and the tagging agree on it — which is exactly why it is a value passed to
    // both and not a call inside either.
    const now = Math.floor(Date.now() / 1000);
    let snap;
    try {
      snap = await runCell(cli, cell, now);
    } catch (e) {
      snap = `harness threw: ${e.message}`;
    }
    if (typeof snap === 'string') {
      failures.push(`  ${cell.id}: server failed\n    ${snap}`);
    } else {
      const vacuous = checkExpectations(cell, snap, now, 'the candidate');
      if (vacuous.length) {
        failures.push(`  ${cell.id}: VACUOUS\n${vacuous.map((p) => `    ${p}`).join('\n')}`);
      } else {
        const recorded = snapshotIo.read(against, cell.id);
        if (recorded === null) {
          failures.push(`  ${cell.id}\n    NO RECORDED SNAPSHOT in ${against} — a cell that ran `
            + 'with nothing to compare against is a hole, not a pass');
        } else {
          // The per-cell half first, then the shared table — the ordering the reference has,
          // and it matters: the rules fingerprint is scoped on the RAW provenance line rather
          // than on the `<DATE>` tag it becomes.
          const normalised = corpusNormalise(webCorpusNormalise(snap, now, process.pid));
          const problems = snapshotIo.compare(recorded, normalised);
          if (problems.length) failures.push(`  ${cell.id}\n${problems.join('\n')}`);
        }
      }
    }
    done += 1;
    if (done % 10 === 0) {
      console.log(`[web-golden]   ${done}/${cells.length} (${failures.length} failing)`);
    }
  }

  const orph = orphanCheck(against, new Set(cells.map((c) => c.id)), narrowingReason(a));
  if (orph && orph.skipped) console.log(`[corpus] ${orph.skipped}`);
  else if (orph) {
    failures.push(`  CORPUS ORPHANS: ${orph.orphans.length} recorded snapshot(s) in ${against} `
      + 'were not consumed by this run\n'
      + orph.orphans.slice(0, 10).map((n) => `    ${n}`).join('\n'));
  }

  if (failures.length) {
    console.error(`\n[web-golden] ${failures.length}/${cells.length} cells DIFFER:\n`);
    console.error(failures.slice(0, a.limit).join('\n\n'));
    if (failures.length > a.limit) console.error(`\n... and ${failures.length - a.limit} more`);
    return 1;
  }
  console.log(`[web-golden] ok — ${cells.length} cells`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((rc) => process.exit(rc))
    .catch((e) => { console.error(`[web-golden] ${e.stack || e.message}`); process.exit(2); });
}
