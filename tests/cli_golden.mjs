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
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PLATFORM_CORPUS, ROOT, corpusNormalise, dropUncompared, orphanCheck,
} from './helpers/golden.mjs';
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

// ---------------------------------------------------------------------------------------
// THE NINE CELLS THE FROZEN CORPUS BINDS TO ONE MACHINE
// ---------------------------------------------------------------------------------------
//
// `status` renders a box panel and pads every row out to the widest one. The widest row is
// usually `components`, which is machine-independent — but the `AGENT.md` row carries the
// sandbox path, and once that path is long enough the panel widens to fit it. The padding is
// computed BEFORE the path is normalised to `<HOME>`, so the recorded panel width is a direct
// readout of the RECORDING MACHINE'S temp-root length.
//
// Measured: this laptop's temp root is 33 characters and GitHub's Windows runner's is 39
// (`guill` against `runneradmin`), and those six characters push the `AGENT.md` row past the
// `components` row — so all nine cells replay six columns wider on every row, ~84 bytes of
// `<stdout>` each.
//
// THIS CANNOT BE NORMALISED AWAY AFTER THE FACT, and that is the part worth stating. A corpus
// stamp added now would change only the LIVE side: the recorded snapshot is a sha256 taken over
// the bytes as they stood under the stamp table in force when it was recorded, and the corpus
// can never be re-recorded. So there is no widening of the normaliser that makes these nine
// pass — only a declaration of where they hold.
//
// `docs/limits.md` predicted exactly this ("a different Windows username reddens it, and
// after the reference is deleted a red padding run is unanswerable"). What is new is that a
// Windows CI job now exists to make it concrete: the Python `cells` job is Linux-only, so the
// `crlf` half had never been replayed anywhere but the machine that recorded it.
//
// SKIPPED, LOUDLY, AND ONLY WHERE THEY CANNOT HOLD. On the recording machine the length matches
// and all nine run. Anywhere else they are announced by name with both lengths printed, because
// a skip is not a pass.
const PANEL_CELLS = new Set([
  'status/a-bogus-footprint-marker-warns-on-stderr',
  'status/a-directory-named-like-a-fact-is-not-counted',
  'status/agent-md-missing-is-called-out',
  'status/an-opencode-global-install',
  'status/memory-index-and-readme-are-not-facts',
  'status/no-memory-store-found',
  'status/posture-and-mode-in-the-carrier-change-nothing',
  'status/the-ascii-overlay-swaps-every-glyph',
  'status/theme-detected-from-the-agent-md-sigil',
]);

// The temp-root length the `crlf` corpus was recorded under. Measured, not guessed:
// `C:\Users\guill\AppData\Local\Temp` is 33 characters. The `lf` half is recorded and replayed
// on the same ubuntu image, where `/tmp` is 4 on both, so the check is a no-op there.
const RECORDED_TMP_ROOT_LEN = process.platform === 'win32' ? 33 : 4;

export function panelCellsHold() {
  return fs.realpathSync.native(os.tmpdir()).length === RECORDED_TMP_ROOT_LEN;
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
 * THE INTERPRETER IS RESOLVED TOO, and leaving it bare was the second half of the same bug.
 * Several cells REPLACE `PATH` — the `link`/`unlink` ones hand the verb a PATH with no
 * `powershell` on it, which is how the "said nothing about PATH" branch is reached honestly —
 * and `spawnSync` then cannot find a bare `node` at all: 12 cells reported `spawn node ENOENT`
 * and were scored as the CLI crashing. The reference hit the mirror image of this on Linux,
 * where `execvpe` resolves against the CHILD's PATH and `CreateProcess` resolves against the
 * parent's. `process.execPath` is not under ROOT, so `repoint` leaves it alone and a checkout
 * cell still runs the copy's script with the machine's own node.
 *
 * A SCRIPT, NOT ANY TOKEN THAT NAMES SOMETHING. The first draft resolved every argument whose
 * name existed under ROOT, which turned the VERB `web` — in `node bin/geneseed-cli.mjs web` —
 * into `<ROOT>/web`, the source directory of the console. The CLI answered `invalid choice` and
 * all 114 web cells reported their server as failing to start. A candidate command is an
 * interpreter plus a script plus verbs, and only the script is a path.
 */
export function resolveCli(cmd) {
  return cmd.split(' ').filter(Boolean).map((tok, i) => {
    if (i === 0) return tok === 'node' ? process.execPath : tok;
    if (!/\.(?:mjs|cjs|js)$/.test(tok)) return tok;
    const abs = path.resolve(ROOT, tok);
    return fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : tok;
  });
}

export function selectCells(doc, a) {
  let cells = doc.cells;
  if (a.only) cells = cells.filter((c) => c.id.startsWith(a.only));
  if (a.first) cells = cells.slice(0, a.first);
  return cells;
}

/**
 * THE PLATFORM UNION, asserted from either host — the property the reference's own
 * `ThePlatformDeclaredCellsAreDeclared` owned, moved here so it travels with the matrix.
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
  const panelsHold = panelCellsHold();
  if (!panelsHold) {
    console.log(`[cli-golden] ${PANEL_CELLS.size} PANEL cells SKIPPED — this machine's temp root `
      + `is ${fs.realpathSync.native(os.tmpdir()).length} characters and the corpus was recorded `
      + `under ${RECORDED_TMP_ROOT_LEN}. status pads its box before the path is normalised, so `
      + `the recorded width is a readout of the recorder's path length and no stamp added now `
      + `can reach a sha256 taken before it existed:\n`
      + [...PANEL_CELLS].map((c) => `    ${c}`).join('\n'));
  }
  const failures = [];
  let done = 0;
  for (const cell of cells) {
    if (!panelsHold && PANEL_CELLS.has(cell.id)) { done += 1; continue; }
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
          // The version-carrying stub, dropped from both sides — see `dropUncompared`. This
          // harness carries it too: leaving it out here left `migrate/a-node-baked-shim-reads-as-
          // current` red while the emit corpus was already green.
          const problems = snapshotIo.compare(
            recorded, dropUncompared(recorded, corpusNormalise(snap)),
          );
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
