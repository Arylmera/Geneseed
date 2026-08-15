// THE CLI CORPUS, REPLAYED — with no Python involved.
//
// 317 cells over 25 verbs, each a sequence of steps run into one sandbox, snapshotted as the
// tree plus four pseudo-files: `<stdout>`, `<stderr>`, `<exit>` and `<dirs>`.
//
// TWO GATES PER CELL, AND THE ORDER MATTERS. The absolute tier runs FIRST, against the
// candidate, and a cell that has stopped exercising what it names is reported VACUOUS instead
// of compared. Only then is the snapshot compared with the recorded bytes. That ordering is not
// cosmetic: the reference's own `--record` once banked six anchor cells with empty verbatim
// text precisely because the absolute tier ran only on the live pair, leaving the two surviving
// modes as pure hash work.
//
// USAGE:
//   node tests/cli_golden.mjs --against tests/__snapshots__/cli
//   ... --cli "node bin/geneseed-cli.mjs" --hook "node bin/geneseed-hook.mjs"
//   ... --only doctor/ --limit 5
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLATFORM_CORPUS, ROOT, corpusNormalise, orphanCheck } from './helpers/golden.mjs';
import { checkExpectations, gitTemplate, runCell } from './helpers/cli_golden.mjs';
import * as snapshotIo from './helpers/snapshot_io.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MATRIX = path.join(HERE, 'helpers', 'matrix');

export function loadMatrix() {
  // PER-PLATFORM, AND THIS ONE REALLY IS. Unlike the emit matrix, the two halves of the CLI
  // matrix are not identical: `link`/`unlink` are different programs on the two platforms, so
  // the halves do not even hold the same cell IDs. Reading the other host's would replay cells
  // this host cannot run.
  const plat = process.platform === 'win32' ? 'win32' : 'posix';
  const f = path.join(MATRIX, `cli.${plat}.json`);
  if (!fs.existsSync(f)) throw new Error(`no exported CLI matrix at ${f}`);
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

export function parseArgs(argv) {
  const a = { limit: 20, cli: 'node bin/geneseed-cli.mjs', hook: 'node bin/geneseed-hook.mjs' };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--against') a.against = argv[++i];
    else if (k === '--cli') a.cli = argv[++i];
    else if (k === '--hook') a.hook = argv[++i];
    else if (k === '--only') a.only = argv[++i];
    else if (k === '--limit') a.limit = Number(argv[++i]);
    else if (k === '--first') a.first = Number(argv[++i]);
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

/**
 * ABSOLUTE, AGAINST THE CHECKOUT — the counterpart of the reference's `_resolve_cli`, and not
 * an optimisation.
 *
 * Every step runs with `cwd` set INSIDE the sandbox (`repo`, `cfg`, a copied checkout), so a
 * relative `bin/geneseed-hook.mjs` resolves against a directory that does not contain it. The
 * first run of this replayer reported all six of its cells VACUOUS for exactly that reason:
 * the spawn produced no output, so every `expect` failed, and the report read like the port had
 * gone silent rather than like the harness had pointed at nothing.
 *
 * The INTERPRETER is left as a bare name on purpose — `repoint` rewrites paths under ROOT into
 * the copied checkout, and a checkout cell must run the copy's script with the machine's own
 * `node`, not a `node` inside the copy.
 */
export function resolveCli(cmd) {
  return cmd.split(' ').filter(Boolean).map((tok, i) => {
    if (i === 0) return tok;
    const abs = path.resolve(ROOT, tok);
    return fs.existsSync(abs) ? abs : tok;
  });
}

export function selectCells(doc, a) {
  let cells = doc.cells;
  if (a.only) cells = cells.filter((c) => c.id.startsWith(a.only));
  if (a.first) cells = cells.slice(0, a.first);
  return cells;
}

/**
 * THE PLATFORM UNION, asserted from either host — the property `test_hook_cli_parity.py`'s
 * `ThePlatformDeclaredCellsAreDeclared` owns, moved here so it travels with the matrix.
 *
 * Every id declared for THIS platform must be built, every id declared for the other must be
 * absent, and neither half may be empty. A group that quietly returned nothing is what the Unix
 * `link` arm used to be, and from Windows that is indistinguishable from a group that has been
 * written — it stayed that way for ten phases.
 */
export function platformDeclarationProblems(doc) {
  const here = process.platform === 'win32' ? 'win32' : 'posix';
  const ids = new Set(doc.cells.map((c) => c.id));
  const table = doc.platform_only;
  const problems = [];
  const halves = { win32: 0, posix: 0 };
  for (const [cid, plat] of Object.entries(table)) {
    halves[plat] = (halves[plat] || 0) + 1;
    if (plat === here && !ids.has(cid)) problems.push(`${cid} is declared for ${here} and is not built`);
    if (plat !== here && ids.has(cid)) problems.push(`${cid} is declared for ${plat} and leaked in`);
  }
  for (const [plat, n] of Object.entries(halves)) {
    if (n === 0) problems.push(`the ${plat} half of the union is empty`);
  }
  return problems;
}

function main(argv) {
  const a = parseArgs(argv);
  const doc = loadMatrix();
  const cells = selectCells(doc, a);
  if (cells.length === 0) throw new Error('the selection is empty — nothing would be checked');

  const against = path.join(a.against, PLATFORM_CORPUS);
  if (!fs.existsSync(against)) throw new Error(`no recorded corpus at ${against}`);

  const declared = platformDeclarationProblems(doc);
  if (declared.length) {
    console.error(`[cli-golden] the platform union is not what it declares:\n`
      + declared.map((p) => `  ${p}`).join('\n'));
    return 1;
  }
  // The half this host is NOT running, printed — so a run says out loud what it skipped.
  const other = Object.entries(doc.platform_only)
    .filter(([, p]) => p !== (process.platform === 'win32' ? 'win32' : 'posix'))
    .map(([cid]) => cid);
  console.log(`[cli-golden] ${cells.length} cells, against ${path.relative(ROOT, against)}`);
  console.log(`[cli-golden] not run on this platform (${other.length}): ${other.join(', ')}`);

  const bins = { cli: resolveCli(a.cli), hook: resolveCli(a.hook) };
  const failures = [];
  let done = 0;
  for (const cell of cells) {
    const snap = runCell(bins[cell.bin || 'hook'], cell);
    if (typeof snap === 'string') {
      failures.push(`  ${cell.id}: CLI failed\n    ${snap}`);
    } else {
      // THE ABSOLUTE TIER FIRST. A cell that has stopped exercising what it names is never
      // compared and never blessed.
      const vacuous = checkExpectations(cell, snap, 'the candidate');
      if (vacuous.length) {
        failures.push(`  ${cell.id}: VACUOUS\n${vacuous.map((p) => `    ${p}`).join('\n')}`);
      } else {
        const recorded = snapshotIo.read(against, cell.id);
        if (recorded === null) {
          failures.push(`  ${cell.id}\n    NO RECORDED SNAPSHOT in ${against} — a cell that ran `
            + 'with nothing to compare against is a hole, not a pass');
        } else {
          const problems = snapshotIo.compare(recorded, corpusNormalise(snap));
          if (problems.length) failures.push(`  ${cell.id}\n${problems.join('\n')}`);
        }
      }
    }
    done += 1;
    if (done % 20 === 0) console.log(`[cli-golden]   ${done}/${cells.length} (${failures.length} failing)`);
  }

  const orph = orphanCheck(against, new Set(cells.map((c) => c.id)), narrowingReason(a));
  if (orph && orph.skipped) console.log(`[corpus] ${orph.skipped}`);
  else if (orph) {
    failures.push(`  CORPUS ORPHANS: ${orph.orphans.length} recorded snapshot(s) in ${against} `
      + 'were not consumed by this run\n'
      + orph.orphans.slice(0, 10).map((n) => `    ${n}`).join('\n'));
  }

  if (failures.length) {
    console.error(`\n[cli-golden] ${failures.length}/${cells.length} cells DIFFER:\n`);
    console.error(failures.slice(0, a.limit).join('\n\n'));
    if (failures.length > a.limit) console.error(`\n... and ${failures.length - a.limit} more`);
    return 1;
  }
  console.log(`[cli-golden] ok — ${cells.length} cells`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let rc = 2;
  try {
    rc = main(process.argv.slice(2));
  } catch (e) {
    console.error(`[cli-golden] ${e.stack || e.message}`);
  } finally {
    // The template is one temp tree shared by every upgrade cell; nothing writes to it after it
    // is built, so it is torn down once at the end rather than per cell.
    try { gitTemplate().cleanup(); } catch { /* never built */ }
  }
  process.exit(rc);
}
