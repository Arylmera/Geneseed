/**
 * The two Node entry points' own gates — `tests/test_hook_cli_parity.py`.
 *
 * WHY THERE ARE TWO ENTRIES. `bin/geneseed-hook.mjs` carries the four verbs an emitted
 * `settings.json` invokes and is kept minimal because the machine-wide shim execs it on every
 * tool call; `bin/geneseed-cli.mjs` carries the harness subcommands a hook never invokes. The
 * recorded CLI matrix proves the two BEHAVE as recorded across its cells. It cannot prove that
 * the four verbs it exercises are the four an emitted settings.json actually invokes — a fifth
 * hook wired in `js/settings.mjs` would simply never be replayed, and an absent row reads exactly
 * like a forgotten one. That is load-bearing rather than tidy: the shim is machine-wide
 * (`~/.geneseed/bin/geneseed-hook[.cmd]`, no per-install component) and last-writer-wins.
 *
 * EVERY TABLE HERE IS READ FROM ITS SOURCE OF TRUTH, never listed. `js/settings.mjs` is parsed
 * for what it wires, the two `VERBS` tables for what they carry, `js/cli-table.json` for what the
 * driver dispatches, and the exported matrices for what is recorded. A copy of any of them in
 * this file would drift alongside whatever it was supposed to catch.
 *
 * THE ONE EXCEPTION IS `NATIVE`, and it is exactly the thing that cannot be derived: the verbs
 * that never had a CPython original and so can never have a recorded cell. See its docblock — it
 * is listed on purpose, and cross-checked against the sibling copy in `tests/snapshot/cli_help.test.mjs`.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseArgs, resolveCli, selectCells } from '../cli_golden.mjs';
import { checkExpectations, cloneCheckout, repoint } from '../helpers/cli_golden.mjs';
import { cellEnv, makeSandbox, strippedEnv } from '../helpers/sandbox.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

/** A named brace block out of a source file, with both ends asserted. */
function block(text, start, end, where) {
  const from = text.indexOf(start);
  assert.ok(from >= 0, `${where} no longer contains ${JSON.stringify(start)}`);
  const rest = text.slice(from);
  const to = rest.indexOf(end);
  assert.ok(to > 0, `${where}'s ${JSON.stringify(start)} block has no ${JSON.stringify(end)}`);
  return rest.slice(0, to);
}

/**
 * The verbs `js/settings.mjs` actually wires into an emitted settings.json — the contract the
 * hook entry has to satisfy, read out of the emitter.
 */
function wiredHookVerbs() {
  const body = block(read('js', 'settings.mjs'), 'export function claudeHookGroups', '\n}\n',
    'js/settings.mjs');
  return new Set([...body.matchAll(/\$\{run\}\s+([a-z][a-z-]*)/g)].map((m) => m[1]));
}

/** The verbs an entry point carries, read out of its own `VERBS` table. */
function verbsOf(rel) {
  const body = block(read(...rel.split('/')), 'const VERBS = {', '\n};', rel);
  const found = new Set([...body.matchAll(/^ {2}'?([a-z][a-z-]*)'?:\s*\{/gm)].map((m) => m[1]));
  assert.ok(found.size > 0, `${rel}'s VERBS table parsed as empty — every claim about it below `
    + 'would be vacuous');
  return found;
}

const HOOK = 'bin/geneseed-hook.mjs';
const CLI = 'bin/geneseed-cli.mjs';

/** Every name the driver's table dispatches — the successor to the reference's argparse walk. */
function tableCommands() {
  const t = JSON.parse(read('js', 'cli-table.json'));
  assert.ok(Array.isArray(t.commands) && t.commands.length > 0, 'js/cli-table.json has no commands');
  return new Set(t.commands.map((c) => c.name));
}

const sorted = (s) => [...s].sort();

// ---------------------------------------------------------------------------------------------
// `TheVerbSetIsATable` — when a second instance of a hazard appears, the gate becomes a table
// cross-checked against the source of truth, because a hardcoded single value covers the new one
// with nothing at all.

test('the hook entry carries exactly the verbs the emitter wires', () => {
  const wired = wiredHookVerbs();
  assert.deepEqual(sorted(wired), ['context', 'git-gate', 'learn', 'rule-gate'],
    'js/settings.mjs wires a different set of hook commands than this gate was written for — '
    + 'read the new one before deciding what it needs');
  assert.deepEqual(sorted(verbsOf(HOOK)), sorted(wired),
    'bin/geneseed-hook.mjs and the emitted settings.json disagree about which verbs are hooks. A '
    + 'wired verb the entry does not carry is a dead hook the day the shim names this file; a '
    + 'verb it carries that nothing wires is unreachable code no cell can reach either.');
});

test('every entry verb is a command the driver table dispatches', () => {
  // WHAT THIS REPLACES, and it is stronger than what it replaces. The reference checked both
  // VERBS tables against `rituals/harness.py`'s argparse subparsers plus its ALIASES, because the
  // shim bakes one entry and a Node-emitted install had to be interchangeable with a
  // Python-emitted one. After the cut there is no Python-emitted install to be interchangeable
  // with, so that comparison genuinely stops meaning anything — but `js/cli-table.json` is the
  // declaration the driver dispatches from, and it outlives the reference.
  //
  // ASSERTED AS A PARTITION WITH NO SLACK IN EITHER DIRECTION: every verb either entry carries is
  // a command, and every command is carried by exactly one entry. The reference could only check
  // one of those two directions, because `harness.py` legitimately answered to names neither Node
  // entry carried. The alias relationship it had to read out of argparse (`upgrade` aliased
  // `update`) is two ordinary rows here, in both the table and the CLI entry.
  const table = tableCommands();
  const hook = verbsOf(HOOK);
  const cli = verbsOf(CLI);
  const union = new Set([...hook, ...cli]);
  assert.deepEqual(sorted(union), sorted(table),
    'the two entry points and js/cli-table.json disagree about the verb set. A verb in the table '
    + 'and in no entry is a command the driver advertises and nothing answers; a verb in an entry '
    + 'and not in the table is one no help text mentions and no doc gate can check.');
});

test('the two entry points carry disjoint verb sets', () => {
  // P5c split the Node side in two where the reference was one program, so a verb now belongs to
  // exactly one of them. A verb in BOTH tables would be two implementations of one command with
  // nothing saying which one a user reaches — the shim bakes the hook entry and a person types
  // the CLI one. It would also hollow out the equality above in the direction that matters: the
  // hook entry could grow `exclude` and stay "equal" to the wired set only by the CLI entry
  // dropping it.
  const both = sorted(new Set([...verbsOf(HOOK)].filter((v) => verbsOf(CLI).has(v))));
  assert.deepEqual(both, [], `${both} is carried by BOTH Node entry points`);
});

// ---------------------------------------------------------------------------------------------
// THE RECORDED MATRIX, as the two exported halves.
//
// The reference read `harness_golden.cells()` and called `_link_cells_win()` / `_link_cells_posix()`
// directly. Both die at the cut; what replaces them is already in the tree, and is in one respect
// better: `tests/helpers/matrix/cli.{win32,posix}.json` are the two arms ALREADY EVALUATED, one on
// each operating system, so "call both arms from one host" is a file read rather than a function
// call that has to be platform-honest.

function matrix(plat) {
  const doc = JSON.parse(read('tests', 'helpers', 'matrix', `cli.${plat}.json`));
  assert.equal(doc.platform, plat, `cli.${plat}.json declares platform ${doc.platform}`);
  assert.ok(doc.cells.length > 100, `cli.${plat}.json holds ${doc.cells.length} cells`);
  return doc;
}

const HERE = process.platform === 'win32' ? 'win32' : 'posix';
const OTHER = HERE === 'win32' ? 'posix' : 'win32';

/**
 * ⚠ THE VERBS NO CELL CAN EVER COVER — the second instance of the hazard `tests/snapshot/cli_help.test.mjs`
 * names first, under the same name and for the same reason.
 *
 * A cell is a COMPARISON of two implementations. `catalog`, `mcp` and `memory` reached the product
 * through the web console and never had a subcommand, so `rituals/harness.py` has nothing to be
 * compared against and never will: the recorder is being deleted, and adding a subparser so a
 * corpus could be recorded would author the expected value in Python and record it back — a copy
 * of a value under test wearing a corpus's clothes.
 *
 * So the equality below becomes TWO NAMED POPULATIONS rather than a weakened one. Listing the
 * native three by name is what keeps this a gate: a FOURTH verb with no cells falls into neither
 * population and fails loudly, where a `covered ⊆ carried` containment would have let it through
 * ungated. What the three are held to instead lives in `tests/snapshot/cli_help.test.mjs` (help layout) and
 * in the absolute gates of their own units — nothing here claims to gate their behaviour.
 */
const NATIVE = ['catalog', 'mcp', 'memory'];

test('the matrix covers every verb each entry claims', () => {
  // PER BINARY, and that is the shape P5c forced. A cell declares which entry answers it, so the
  // partition has two sides and each is checked against the table it belongs to. Collapsing them
  // — asserting only that the union matches — would let a cell be filed under the wrong binary
  // and still pass.
  const covered = { hook: new Set(), cli: new Set() };
  for (const c of matrix(HERE).cells) covered[c.bin ?? 'hook'].add(c.id.split('/')[0]);
  assert.deepEqual(sorted(covered.hook), sorted(verbsOf(HOOK)),
    'the recorded hook cells and the hook entry point\'s verbs have diverged: an uncovered verb '
    + 'is an unported one nothing would report');
  // THE RECORDED HALF, still an equality with no slack: every CLI verb that is not named native
  // must have cells, and every recorded verb must still be carried. A new verb that nobody adds
  // to `NATIVE` lands on the left of this and fails — which is the whole point of naming them.
  const cli = verbsOf(CLI);
  assert.deepEqual(sorted(covered.cli), sorted([...cli].filter((v) => !NATIVE.includes(v))),
    'the recorded cli cells and bin/geneseed-cli.mjs\'s verbs have diverged. If the verb is NEW '
    + 'and Node-native there is no reference to record a cell against — name it in NATIVE and '
    + 'gate it absolutely. Do NOT delete cells to make this pass: the corpus can never be re-made');
  // …and the other direction, so the list cannot rot into prose: a name in `NATIVE` that no entry
  // point carries is an exemption for a verb that no longer exists, silently excusing whatever
  // takes its place.
  assert.deepEqual(NATIVE.filter((v) => !cli.has(v)), [],
    'NATIVE names a verb bin/geneseed-cli.mjs does not carry — an exemption with nothing behind it');
});

test('the two copies of the native-verb list agree', () => {
  // THE COST OF LISTING IT TWICE, paid rather than deferred. `tests/snapshot/cli_help.test.mjs` names the
  // same three for the same reason, and two hand-written copies of one decision drift in exactly
  // the way this file's header says a listed table drifts — one file exempts a verb the other
  // still demands a corpus for, and the second failure reads like a missing recording.
  //
  // A SHARED HOME UNDER tests/helpers/ IS THE REAL FIX; this is the gate that makes its absence
  // safe until then, and it is read from the sibling's source so neither copy is the authority.
  const other = read('tests', 'snapshot', 'cli_help.test.mjs');
  const listed = [...block(other, 'const NATIVE = [', '];', 'tests/snapshot/cli_help.test.mjs')
    .matchAll(/'([a-z][a-z-]*)'/g)].map((m) => m[1]);
  assert.deepEqual(sorted(listed), sorted(NATIVE),
    'tests/snapshot/cli_help.test.mjs and this file disagree about which verbs are Node-native');
});

test('every cell declares a binary that exists', () => {
  // A typo'd `bin` used to send a cell to the REFERENCE on both sides, which always passes. The
  // replayer has no reference to fall back to, so the same typo now sends it to an undefined
  // command — but the claim is the same one and it is cheaper to keep than to re-derive.
  for (const plat of ['win32', 'posix']) {
    const bad = sorted(new Set(matrix(plat).cells
      .filter((c) => !['hook', 'cli'].includes(c.bin ?? 'hook')).map((c) => c.id)));
    assert.deepEqual(bad, [], `cli.${plat}.json has cells with an unknown bin: ${bad}`);
  }
});

// ---------------------------------------------------------------------------------------------
// `ThePlatformDeclaredCellsAreDeclared` — and the hole it closes has a ten-phase history.
//
// The `link` group returned nothing at all on any non-Windows host, and from Windows — the only
// machine that ever ran the harnesses — an empty group is indistinguishable from a group that was
// written and passes. Nothing failed; `docs/limits.md` row 5 said so in prose, and prose is
// not a gate. A gate that fires on the OTHER platform is not a gate the developer ever sees.
//
// THREE OF THE FIVE ARE ALREADY HOME. `tests/cli_golden.mjs`'s `platformDeclarationProblems`
// travels with the matrix and asserts: every id declared for this platform is built, every id
// declared for the other is absent, and neither half is empty. It runs on every replay, on both
// operating systems in CI. What it cannot do is read the OTHER half — it deliberately loads one
// file — so the two directions that need both are here.

test('the declaration is exactly the union of the two recorded halves', () => {
  // THE DIRECTION THAT ACTUALLY STOPS DRIFT, and the only one checkable from a single host.
  // Without it, adding a cell to the arm the developer is not on is invisible: the replayer's
  // three checks only ever compare the table against the half this host builds, so a Windows
  // session can add a POSIX cell, forget the table, and see green.
  const win = matrix('win32');
  const posix = matrix('posix');
  assert.deepEqual(win.platform_only, posix.platform_only,
    'the two exported halves carry different platform_only tables, so the union depends on which '
    + 'one a reader happens to open');
  const wid = new Set(win.cells.map((c) => c.id));
  const pid = new Set(posix.cells.map((c) => c.id));
  const built = {};
  for (const id of wid) if (!pid.has(id)) built[id] = 'win32';
  for (const id of pid) if (!wid.has(id)) built[id] = 'posix';
  assert.deepEqual(built, win.platform_only,
    'platform_only and the two recorded halves disagree — every cell one platform can run and the '
    + 'other cannot has to be in the table, under the platform that runs it');
  // A cell present in both halves is shared and must NOT be in the table; the check above already
  // rejects that, but only because `built` is derived from the difference. This says the halves
  // really do share most of their cells, so the derivation had something to subtract.
  assert.ok([...wid].filter((id) => pid.has(id)).length > 100,
    'the two halves share almost no cells, so they are not two arms of one matrix');
});

test('the declaration is not empty in either direction', () => {
  // The positive control. An empty table satisfies every test above it, and an empty table is
  // exactly the state this mechanism exists to make impossible.
  const byPlatform = {};
  for (const [id, plat] of Object.entries(matrix(HERE).platform_only)) {
    (byPlatform[plat] ??= []).push(id);
  }
  assert.deepEqual(sorted(new Set(Object.keys(byPlatform))), ['posix', 'win32'],
    'platform_only must name both halves — a table with one side is a declaration that one '
    + 'operating system has no cells of its own');
  for (const [plat, ids] of Object.entries(byPlatform)) {
    assert.ok(ids.length > 0, `the ${plat} half is empty`);
  }
  assert.ok(byPlatform[OTHER].length > 0,
    `this ${HERE} host claims to run every cell there is, which would mean the two link arms had `
    + 'become one program');
});

test('the verb-coverage gate is satisfied by both halves, not just this one', () => {
  // `the matrix covers every verb each entry claims` reads the verb before the `/`, so a platform
  // whose half covered only `link` would leave `unlink` uncovered — on that platform only, where
  // nobody is looking. Checked here for the union, from anywhere.
  const table = matrix(HERE).platform_only;
  for (const plat of ['win32', 'posix']) {
    const verbs = new Set(Object.entries(table).filter(([, p]) => p === plat)
      .map(([id]) => id.split('/')[0]));
    assert.deepEqual(sorted(verbs), ['link', 'unlink'],
      `the ${plat} half of the platform table covers ${sorted(verbs)}`);
  }
});

// ---------------------------------------------------------------------------------------------
// `TheAcceptanceHarnessIsNotVacuous` — the harness is code, its expectations are code, and five
// consecutive phases of this port ended with the gate's own body as the defect.
//
// The subject moves from `tests/harness_golden.py` to `tests/cli_golden.mjs` and its helper: the
// cells are the exported matrices, the vacuity checker is `checkExpectations`, and the narrowing
// flags are `parseArgs`/`selectCells`. Every claim below is about the replayer that outlives the
// reference rather than about the harness that does not.

const EXPECT_KINDS = ['expect', 'expect_absent', 'expect_re', 'expect_silent', 'expect_files',
  'expect_absent_files'];

test('every cell states what the port must do', () => {
  // A cell with no absolute assertion is replayed and nothing more — and these verbs are SILENT
  // on almost every path by design, so a port that stopped working would still match a recorded
  // snapshot of it doing nothing.
  for (const plat of ['win32', 'posix']) {
    const naked = matrix(plat).cells
      .filter((c) => !EXPECT_KINDS.some((k) => (Array.isArray(c[k]) ? c[k].length : c[k])))
      .map((c) => c.id);
    assert.deepEqual(naked, [], `cli.${plat}.json holds cells with no expectation at all: ${naked}`);
  }
  // Second instance of this list, so it stops being prose: the checker must READ every kind the
  // cells are allowed to declare. A kind added to the matrix and forgotten in `checkExpectations`
  // would be a silently ignored assertion.
  const helper = read('tests', 'helpers', 'cli_golden.mjs');
  const checker = block(helper, 'export function checkExpectations', '\n}\n',
    'tests/helpers/cli_golden.mjs');
  for (const kind of EXPECT_KINDS) {
    // `cell.<kind>` with a word boundary, not a bare substring: `expect` is a prefix of four of
    // the other five, so `includes('expect')` is satisfied by a checker that reads only
    // `expect_absent` — which is the same class of false green this list exists to prevent.
    assert.match(checker, new RegExp(`cell\\.${kind}\\b`),
      `cells may declare ${kind} but the vacuity checker never reads it`);
  }
});

test('no cell hardcodes a source fingerprint', () => {
  // `sourceFingerprint` hashes the whole source tree, so it changes with every commit. A cell may
  // COMPARE it — both sides compute it from the same tree at the same instant — but a cell that
  // NAMES one is green until the next commit and then reports a port regression that is nothing
  // of the kind. The seeded stamps are 12 hex digits by design, so this refuses any other run of
  // twelve the harness did not itself write.
  const seeded = new Set(['deadbeef1234', '0123456789ab']);
  let scanned = 0;
  for (const plat of ['win32', 'posix']) {
    for (const c of matrix(plat).cells) {
      for (const field of ['expect', 'expect_absent', 'expect_re']) {
        for (const s of c[field] ?? []) {
          scanned += 1;
          const bad = [...new Set(s.match(/\b[0-9a-f]{12}\b/g) ?? [])]
            .filter((h) => !seeded.has(h));
          assert.deepEqual(bad, [],
            `${c.id} names ${bad}, which looks like a live source fingerprint`);
        }
      }
    }
  }
  assert.ok(scanned > 500, `only ${scanned} expectation strings were scanned`);
});

test('cell ids are unique within each half', () => {
  for (const plat of ['win32', 'posix']) {
    const ids = matrix(plat).cells.map((c) => c.id);
    assert.equal(ids.length, new Set(ids).size,
      `two cells in cli.${plat}.json share an id, so one of them is invisible in the report`);
  }
});

test('the vacuity check reports each kind of broken expectation', () => {
  // THE CHECKER IS THE GATE'S GATE and nothing else watches it. Deleting the `expect` loop leaves
  // the whole matrix green: every cell still replays, every replay still matches, and the one
  // thing that would have noticed a cell no longer exercising what it names is gone. Declaring an
  // expectation and RUNNING it are two properties, and the test above only covers the first.
  const snap = new Map([
    ['<stdout>', Buffer.from('hello world')], ['<stderr>', Buffer.alloc(0)],
    ['<exit>', Buffer.from('0')], ['made/it.md', Buffer.alloc(0)],
    ['<dirs>', Buffer.from('made\nmade/husk')],
  ]);
  assert.deepEqual(checkExpectations({
    expect: ['hello'], expect_absent: ['goodbye'], expect_re: ['hello \\w+'],
    expect_files: ['made/it.md'], expect_absent_files: ['made/gone.md', 'made/gone'],
  }, snap), [], 'a cell whose every expectation holds was reported as broken');
  for (const [kind, cell] of [
    ['expect', { expect: ['absent phrase'] }],
    ['expect_absent', { expect_absent: ['hello'] }],
    ['expect_re', { expect_re: ['hello \\d+ world'] }],
    ['expect_silent', { expect_silent: true }],
    ['expect_files', { expect_files: ['never/written.md'] }],
    // Both halves of the sixth kind: a surviving FILE and a surviving DIRECTORY. The second is
    // what the `<dirs>` column exists for — reading only the file map, an empty husk is invisible.
    ['expect_absent_files/file', { expect_absent_files: ['made/it.md'] }],
    ['expect_absent_files/dir', { expect_absent_files: ['made/husk'] }],
  ]) {
    assert.ok(checkExpectations(cell, snap).length > 0,
      `${kind} was violated and the checker said nothing`);
  }
  // And the column the directory half depends on must be REQUIRED. Without this, a fixture that
  // stopped recording directories leaves every husk assertion passing on an empty set — the cells
  // stay green and observe half of what they claim.
  for (const [label, dirs] of [['missing', null], ['empty', ''], ['blank', '   \n']]) {
    const broken = new Map(snap);
    broken.delete('<dirs>');
    if (dirs !== null) broken.set('<dirs>', Buffer.from(dirs));
    assert.ok(checkExpectations({ expect_absent_files: ['made/husk'] }, broken).length > 0,
      `a ${label} <dirs> column let a directory assertion pass unexamined`);
  }
});

test('both candidate binaries always resolve to a real script', () => {
  // WHAT REPLACED THE REFERENCE'S REFUSAL, and the failure mode moved with it. There, `--new`
  // without `--new-cli` sent every non-hook cell to the REFERENCE on both sides, and a cell
  // compared against itself always passes — an unported verb read as a ported one. The replayer
  // has no reference to fall back to, so that exact hole cannot exist: both binaries carry
  // defaults and `resolveCli` turns each into an absolute path.
  //
  // The hazard that DID survive is the one `resolveCli`'s docblock records: a candidate command
  // that resolves to nothing produces no output, every `expect` fails, and the report reads like
  // the port went silent rather than like the harness pointed at nothing. That cost this replayer
  // six cells on its first run and twelve more on the second. So both defaults are resolved, and
  // both the interpreter and the script are required to be real absolute paths.
  const a = parseArgs(['--against', 'unused']);
  for (const [flag, cmd] of [['--cli', a.cli], ['--hook', a.hook]]) {
    const argv = resolveCli(cmd);
    assert.ok(argv.length >= 2, `${flag} resolved to ${JSON.stringify(argv)}`);
    assert.equal(argv[0], process.execPath, `${flag}'s interpreter was left bare, so a cell that `
      + 'replaces PATH cannot start it');
    const script = argv.find((t) => /\.mjs$/.test(t));
    assert.ok(script && path.isAbsolute(script) && existsSync(script) && statSync(script).isFile(),
      `${flag}'s script resolved to ${JSON.stringify(script)}, which is not a file on disk`);
  }
});

test('--only narrows the matrix, and an empty selection is refused', () => {
  // A narrowing flag needs its own WIRING test, separate from any test of what it narrows — the
  // reference shipped one whose gate was correct and simply not connected.
  const doc = matrix(HERE);
  const every = doc.cells.length;
  const narrowed = selectCells(doc, { only: 'git-gate' });
  assert.ok(narrowed.length > 0, 'no git-gate cells at all, so this proves nothing');
  assert.ok(narrowed.length < every, '--only narrowed nothing here, so this proves nothing');
  assert.ok(narrowed.every((c) => c.id.startsWith('git-gate')), 'a non-matching cell survived');
  assert.equal(selectCells(doc, { only: 'nosuchverb' }).length, 0);
  // ...and the WIRING half, in a child, because the refusal is the replayer's own exit path: a
  // run that selected nothing and reported "0 cells, no differences" reads exactly like a green
  // one. This exits before any cell is replayed, so it costs a process and nothing else.
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tests', 'cli_golden.mjs'),
    '--against', path.join(ROOT, 'tests', '__snapshots__', 'cli'), '--only', 'nosuchverb'],
  { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(r.status, 0, `the replayer accepted an empty selection:\n${r.stdout}`);
  assert.match(`${r.stdout}${r.stderr}`, /selection is empty/,
    `it refused for some other reason:\n${r.stderr.slice(-500)}`);
});

// ---------------------------------------------------------------------------------------------
// THE PASSTHROUGH REFUTATIONS — `TheHookEntryIsNotAPassthrough` (3) and
// `TheHarnessCliIsNotAPassthrough` (6).
//
// A shell around `python rituals/harness.py` would pass every recorded cell perfectly, because it
// would BE the reference. So the refutation is two-sided and neither side is enough alone: a
// STATIC allow-list of what may start a process, and DYNAMIC runs of the verbs that must never
// start one with every Python stripped from PATH. Static alone cannot see an absolute-path
// `spawn('C:/Python313/python.exe')`; dynamic alone cannot see a spawn on a path no test reaches.
//
// EVERY MODULE ALLOWED TO START A PROCESS, with the exact thing it may start. The criterion for a
// row is NOT "this verb spawns" — `build` spawns on the reference and is refused here — it is that
// there is no in-process equivalent AND the spawned thing is not this program. `node --check`
// compiles ESM in a way `vm.Script` cannot; `java -version` asks a foreign toolchain a question
// about itself. `js/web/jobs.mjs` breaks the second half on purpose and its argument is isolation:
// the reference's daemon is THREADED and this one is not, so an in-process job would block the
// event loop that serves the progress poll watching it.
//
// ⚠ THE REFERENCE'S `entry` COLUMN IS DROPPED, MEASURED RATHER THAN ASSUMED. It existed to say
// which entry point's walk should expect a row, and all seven rows say `cli` — so the filter
// selected every row and filtered nothing, which is a partition with one side and the exact defect
// this file catches in three other places. Dropping it changes no assertion: the CLI walk already
// compared against all seven. The hook entry's own single spawn is gated by name below, which is
// what the column's one interesting row (`hooks.mjs`, delegated) was pointing at anyway.
const ALLOWED_SPAWNS = {
  'hooks.mjs': {
    gatedBy: 'the only spawn in the hook entry is the model CLI',
    what: '`$GENESEED_LLM` — the model CLI `learn` shells out to',
  },
  'doctor.mjs': {
    binding: '{ spawnSync }',
    calls: 1,
    what: '`node --check <plugin>`',
    literals: ["spawnSync(node, ['--check', js]", "const node = pyWhich('node');"],
  },
  'setup.mjs': {
    binding: '{ spawnSync }',
    calls: 1,
    what: '`java -version`',
    literals: ["spawnSync(java, ['-version']", "const java = pyWhich('java');"],
  },
  'link.mjs': {
    binding: '{ spawnSync }',
    calls: 1,
    what: '`powershell -NoProfile -Command <script>` — the persistent USER Path',
    literals: ["const r = spawnSync('powershell',",
      "['-NoProfile', '-Command', winUserPathScript(action, directory)],"],
  },
  'update.mjs': {
    binding: '{ spawn, spawnSync }',
    calls: 6,
    spawnCalls: 1,
    what: '`git …` (the update transport), `taskkill /T` (a timed-out fetch\'s tree), and '
      + '`node bin/geneseed-{cli,}.mjs` re-executed over the PULLED source',
    literals: ["const exe = pyWhich('git');",
      "spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)]",
      "[path.join(String(cand), 'bin', 'geneseed-cli.mjs'), 'doctor', '--all', '--no-bundle'],",
      "[path.join(String(here), 'bin', 'geneseed.mjs'), ...buildArgs],",
      "[path.join(String(here), 'bin', 'geneseed-cli.mjs'), 'rebuild-all'],",
      "const r = spawnSync(argv[0], argv.slice(1), { stdio: 'inherit', ...NO_WINDOW });",
      'child = spawn(exe, args, {'],
  },
  'web/server.mjs': {
    binding: '{ spawn, spawnSync }',
    calls: 1,
    spawnCalls: 2,
    what: '`node bin/geneseed-cli.mjs web --daemon-internal …` (the detached daemon), '
      + '`npm install` / `npm run build`, and the desktop\'s URL opener',
    literals: ["const cmd = [process.execPath, join(ROOT, 'bin', 'geneseed-cli.mjs'), 'web',",
      "detached: true, windowsHide: true, stdio: ['ignore', out, out],",
      "const plan = buildPlan(dist, webDir, pyWhich('npm'), Boolean(process.stdin.isTTY));",
      'const r = spawnSync(win ? `"${npm}"` : npm, step, {',
      "? [process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', `start \"\" \"${url}\"`],",
      "(process.platform === 'darwin' ? ['open', [url], {}] : ['xdg-open', [url], {}]);"],
  },
  'web/jobs.mjs': {
    binding: '{ spawn, spawnSync }',
    calls: 1,
    spawnCalls: 1,
    what: '`node bin/geneseed-cli.mjs <verb>` (the job) and `taskkill /T` (its cancel)',
    literals: ["spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)]",
      'const NODE = () => process.execPath;',
      "const CLI = () => path.join(ROOT, 'bin', 'geneseed-cli.mjs');",
      "const GEN = () => path.join(ROOT, 'bin', 'geneseed.mjs');",
      'p = spawn(cmd[0], cmd.slice(1), {'],
  },
};

/** Every module a file reaches through relative imports, transitively, including itself. */
function importClosure(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f) || !existsSync(f) || !statSync(f).isFile()) continue;
    seen.add(f);
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/from\s+'(\.[^']+)'/g)) {
      queue.push(path.resolve(path.dirname(f), m[1]));
    }
  }
  return seen;
}

const importsChildProcess = (text) => /^\s*import\s.*'node:child_process'/m.test(text);

test('the generator driver still reaches no child-process module', () => {
  // `bin/geneseed.mjs` is banned from spawning AT ALL, and a source grep on the driver alone
  // cannot see an import one module deep: a single `import` of `js/hooks.mjs` would put
  // child_process in the driver's process with its own source still clean. So the walk is
  // transitive, which is the same assertion one level out.
  const closure = importClosure(path.join(ROOT, 'bin', 'geneseed.mjs'));
  assert.ok(closure.size > 1, 'the import walk found no modules, so it proves nothing');
  for (const f of closure) {
    const text = readFileSync(f, 'utf8');
    for (const banned of ['node:child_process', "'child_process'", '"child_process"']) {
      assert.ok(!text.includes(banned),
        `bin/geneseed.mjs reaches ${banned} through ${path.relative(ROOT, f)} — the Node `
        + 'generator must not be able to spawn an interpreter');
    }
  }
});

test('the only spawn in the hook entry is the model CLI', () => {
  // STATIC, and narrower than the driver's ban because it has to be: `learn` genuinely spawns —
  // `$GENESEED_LLM` is the whole verb — so "imports no child-process module" is not the property.
  // The property is that there is exactly ONE spawn site and it is the model CLI, which is what
  // makes the dynamic half below meaningful: an absolute-path `spawn('C:/Python313/python.exe')`
  // never consults PATH and so would never notice that PATH lost anything.
  const text = read('js', 'hooks.mjs');
  // THE IMPORT, not a scan for call sites. A `\bexec\s*\(` scan matches every `SOME_RE.exec(...)`
  // in the file — it fired on three of them — and would still miss `cp.exec()` behind a namespace
  // import. Naming the one binding that may be imported closes both.
  const imports = [...text.matchAll(/import\s+(.+?)\s+from\s+'node:child_process'/g)]
    .map((m) => m[1]);
  assert.deepEqual(imports, ['{ spawnSync }'],
    `js/hooks.mjs imports ${imports} from child_process; exactly one binding is allowed`);
  assert.equal((text.match(/(?<![.\w])spawnSync\s*\(/g) ?? []).length, 1,
    'js/hooks.mjs has more than one spawnSync call site');
  assert.ok(text.includes('const argv = pyWords(llm);'),
    'the one spawn no longer takes its command from $GENESEED_LLM');
  // The entry point must not spawn either — and again the check is the IMPORT, not the word: a
  // scan for the string fired on the module docblock, which explains at length why the DRIVER may
  // not have one.
  assert.ok(!importsChildProcess(read(...HOOK.split('/'))),
    `${HOOK} imports child_process; only js/hooks.mjs's model CLI may`);
});

test('the CLI entry reaches child_process only where it is declared', () => {
  // STATIC and transitive, for the same reason the driver's is. Since the CLI statically imports
  // `js/web/server.mjs`, this equality covers the daemon launcher and the job runner as well as
  // `node --check` and `java -version`.
  const closure = importClosure(path.join(ROOT, ...CLI.split('/')));
  assert.ok(closure.size > 2, 'the import walk found almost nothing, so it proves nothing');
  const importers = [];
  for (const f of closure) {
    const text = readFileSync(f, 'utf8');
    if (importsChildProcess(text)) importers.push(path.relative(path.join(ROOT, 'js'), f));
    for (const banned of ["'child_process'", '"child_process"']) {
      assert.ok(!text.includes(banned),
        `${CLI} reaches a bare ${banned} through ${path.relative(ROOT, f)} — the allow-list is `
        + 'the `node:` specifier only');
    }
  }
  assert.deepEqual(sorted(importers.map((p) => p.replaceAll('\\', '/'))),
    sorted(Object.keys(ALLOWED_SPAWNS)),
    'child_process is imported by a module with no row in the allow-list, or a row names a module '
    + 'that no longer imports it — each row is declared with the exact argv it may start');
});

test('the web module tree spawns only from the declared modules', () => {
  // A TRANSITIVE WALK FROM `js/web/server.mjs` WOULD PROVE THE WRONG THING: that graph reaches
  // `js/doctor.mjs`, `js/setup.mjs` and `js/hooks.mjs`, three modules that legitimately spawn and
  // are declared above. An equality over it would either fail or re-declare all three here, which
  // puts one module's decision in two files. So this is a DIRECTORY scan keyed on the `web/`
  // prefix — every spawning file under `js/web/` has a row.
  const dir = path.join(ROOT, 'js', 'web');
  const declared = new Set();
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.mjs'))) {
    const text = readFileSync(path.join(dir, name), 'utf8');
    if (importsChildProcess(text)) declared.add(`web/${name}`);
    for (const banned of ["'child_process'", '"child_process"']) {
      assert.ok(!text.includes(banned), `js/web/${name} reaches a bare ${banned}`);
    }
  }
  assert.ok(declared.size > 0,
    'the scan found no spawning module under js/web/, so this equality is vacuous');
  assert.deepEqual(sorted(declared),
    sorted(Object.keys(ALLOWED_SPAWNS).filter((r) => r.startsWith('web/'))),
    'a module under js/web/ starts a process without a row — the web daemon is the one place in '
    + 'this port allowed to spawn THIS PROGRAM, and the argument for each argv belongs in the row');
});

test('each declared module spawns only what its row declares', () => {
  // The half a module list cannot state: WHAT each one starts. The call-site scan is anchored on
  // the import BINDING rather than on the word, and the argv is asserted literally, because a
  // second call site reusing the binding to start an interpreter would satisfy a count alone.
  let checked = 0;
  for (const [rel, spec] of Object.entries(ALLOWED_SPAWNS)) {
    if (spec.gatedBy) {
      // A DELEGATED ROW names the test that owns its argv instead of repeating the literals.
      // Checked rather than trusted: a pointer at a test that no longer exists asserts nothing.
      assert.ok(read('tests', 'unit', 'hook_cli.test.mjs').includes(`test('${spec.gatedBy}'`),
        `js/${rel} delegates its argv assertion to a test named ${JSON.stringify(spec.gatedBy)}, `
        + 'which is not in this file — the delegation is the whole gate');
      continue;
    }
    const text = read('js', ...rel.split('/'));
    const imports = [...text.matchAll(/import\s+(.+?)\s+from\s+'node:child_process'/g)]
      .map((m) => m[1]);
    assert.deepEqual(imports, [spec.binding],
      `js/${rel} imports ${imports}; exactly one binding is allowed and it is ${spec.binding}`);
    assert.equal((text.match(/(?<![.\w])spawnSync\s*\(/g) ?? []).length, spec.calls,
      `js/${rel} no longer has ${spec.calls} spawnSync call site(s); ${spec.what} is all it may `
      + 'start');
    // THE ASYNC FORM IS COUNTED SEPARATELY: a count that only knew `spawnSync` would let a second
    // `spawn(...)` naming an interpreter in. `spawnSync(` does not match this pattern, so the two
    // counts partition the call sites rather than overlapping.
    assert.equal((text.match(/(?<![.\w])spawn\s*\(/g) ?? []).length, spec.spawnCalls ?? 0,
      `js/${rel} no longer has ${spec.spawnCalls ?? 0} async spawn call site(s)`);
    for (const literal of spec.literals) {
      assert.ok(text.includes(literal),
        `js/${rel} no longer spawns ${spec.what} the declared way — a spawn taking its command `
        + 'from anywhere else would be the passthrough this entry exists not to be');
    }
    checked += 1;
  }
  assert.ok(checked >= 6, `only ${checked} rows were checked against their source`);
});

// ---------------------------------------------------------------------------------------------
// THE DYNAMIC HALF — the verbs run with every Python stripped from PATH.
//
// This is what makes the allow-list mean "does not shell back to Python" rather than merely
// "spawns little". `run(['python', 'harness.py', <verb>])` is byte-identical to a real port in
// every recorded cell, because the reference is what it would be running. With no python anywhere
// on PATH there is nothing for such a call to find, so an answer is proof the Node code produced
// it. `node` is invoked by absolute path, so stripping PATH cannot take the runtime out from under
// the test.

// `pathWithoutPython`/`strippedEnv` MOVED TO `tests/helpers/sandbox.mjs` in P3 T7, when
// `tests/unit/node_driver.test.mjs` became their second caller. The vacuity guard moved with
// them rather than staying at each call site, and the helper now also clears `$PYTHON` — the
// documented discovery override that `cellEnv` leaves alone, so that a green run here cannot be
// measuring a developer's exported shell.

const runEntry = (entry, argv, env, cwd, input = '') => spawnSync(process.execPath,
  [path.join(ROOT, ...entry.split('/')), ...argv],
  { cwd, env, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

test('the pure hook verbs run with no python on PATH', (t) => {
  // `context`, `git-gate` and `rule-gate` spawn nothing at all, so a passthrough's
  // `spawn('python', …)` dies with ENOENT where a real implementation never notices.
  const sb = makeSandbox('hookcli-pure-');
  try {
    const home = path.join(sb.path, 'home');
    mkdirSync(home, { recursive: true });
    writeFileSync(path.join(sb.path, 'README.md'), '# proof\n', 'utf8');
    const env = strippedEnv(t, home);

    const ctx = runEntry(HOOK, ['context'], env, sb.path);
    assert.equal(ctx.status, 0, `context failed: ${ctx.stderr.slice(0, 400)}`);
    assert.ok(ctx.stdout.includes('# proof'),
      'context produced nothing with python off PATH — it is driving the Python CLI rather than '
      + 'being a second implementation');

    const gate = runEntry(HOOK, ['git-gate'], env, sb.path,
      JSON.stringify({ tool_input: { command: 'git commit -m x' } }));
    assert.equal(gate.status, 0, gate.stderr.slice(0, 400));
    assert.ok(gate.stdout.includes('permissionDecision'),
      'git-gate stopped gating with python off PATH');
  } finally {
    sb.cleanup();
  }
});

test('exclude reads a real install with no python on PATH', (t) => {
  const sb = makeSandbox('hookcli-excl-');
  try {
    const home = path.join(sb.path, 'home');
    const repo = path.join(sb.path, 'repo');
    const cfg = path.join(home, '.claude');
    mkdirSync(cfg, { recursive: true });
    mkdirSync(repo, { recursive: true });
    writeFileSync(path.join(cfg, '.geneseed-manifest.json'), '{"owned": []}\n', 'utf8');
    writeFileSync(path.join(cfg, 'excludes.json'),
      JSON.stringify({ excludes: [{ path: repo.replaceAll('\\', '/') }] }), 'utf8');
    const r = runEntry(CLI, ['exclude', 'list'], strippedEnv(t, home), repo);
    assert.equal(r.status, 0, `exclude list failed: ${r.stderr.slice(0, 400)}`);
    assert.ok(r.stdout.includes('[claude]'),
      'exclude list produced no install row with python off PATH');
  } finally {
    sb.cleanup();
  }
});

test('doctor validates the build with no python on PATH', (t) => {
  // The verb the allow-list was opened for, refuted the same way. `doctor` is the most
  // spawn-shaped verb that has crossed — a full build, five emits and a `node --check` per plugin
  // — and the one where a passthrough would be least visible, since its output would be the
  // reference's own. `--no-bundle` and one theme, because this asserts the plumbing rather than
  // the checks; those are gated one planted fault at a time elsewhere.
  //
  // The sandboxed home matters more here than anywhere else: doctor EMITS, every emit rewrites the
  // machine-wide hook shim, and an unsandboxed run would repoint the developer's own installs at
  // this test's temp directory.
  //
  // ⚠ WHAT THIS DOES NOT SEE, measured by a mutation whose prediction was wrong. Pointing
  // `js/doctor.mjs`'s lookup at `python` instead of `node` leaves this GREEN: the check is silent
  // on success, so a lookup that finds nothing skips its spawn and doctor still reports the theme
  // clean. Only the allow-list row above catches it, by the literal argv. So this test is the
  // passthrough refutation it was written to be — the verb completes with no interpreter anywhere
  // — and it is NOT evidence that the declared spawn happened. The two halves are not redundant
  // and this is the direction that cannot cover the other.
  const sb = makeSandbox('hookcli-doc-');
  try {
    const home = path.join(sb.path, 'home');
    mkdirSync(home, { recursive: true });
    const r = runEntry(CLI, ['doctor', '--theme', 'neutral', '--no-bundle'],
      strippedEnv(t, home), ROOT);
    assert.equal(r.status, 0, `doctor failed with python off PATH:\n${r.stdout.slice(-2000)}\n`
      + `${r.stderr.slice(-2000)}`);
    assert.ok(r.stdout.includes('[doctor] ok — 1 theme(s) clean'), r.stdout.slice(-1500));
  } finally {
    sb.cleanup();
  }
});

test('uninstall removes an install with no python on PATH', (t) => {
  // The first verb that DELETES, and the refutation matters more here than for any verb before it:
  // a passthrough that dies with ENOENT on a machine with no python leaves the install half
  // removed and the operator told it succeeded.
  //
  // ASSERTED ON THE FILESYSTEM rather than on stdout — the whole verb is what is left behind, and
  // a passthrough that printed the right words while deleting nothing is exactly what a recorded
  // cell cannot see either.
  const sb = makeSandbox('hookcli-unin-');
  try {
    const home = path.join(sb.path, 'home');
    const repo = path.join(sb.path, 'repo');
    const cfg = path.join(home, '.claude');
    mkdirSync(path.join(cfg, 'agents'), { recursive: true });
    mkdirSync(repo, { recursive: true });
    writeFileSync(path.join(cfg, '.geneseed-manifest.json'), JSON.stringify({
      owned: ['agents/advocate.md'], managed: { settings_file: 'settings.json' },
    }), 'utf8');
    writeFileSync(path.join(cfg, 'agents', 'advocate.md'), '# owned\n', 'utf8');
    writeFileSync(path.join(cfg, 'PROFILE.md'), '# mine\n', 'utf8');

    const r = runEntry(CLI, ['uninstall', '--yes', '--target', cfg], strippedEnv(t, home), repo);
    assert.equal(r.status, 0, `uninstall failed with python off PATH:\n${r.stdout.slice(-1500)}\n`
      + `${r.stderr.slice(-1500)}`);
    assert.ok(!existsSync(path.join(cfg, 'agents', 'advocate.md')),
      'the owned file survived with python off PATH — the verb is driving the Python CLI');
    assert.ok(!existsSync(path.join(cfg, '.geneseed-manifest.json')),
      'the manifest survived, so nothing completed');
    // The positive control, in the test that proves the deletion happened at all: an
    // implementation that met both assertions above with an `rmtree` would meet them and take the
    // user's own file with it.
    assert.ok(existsSync(path.join(cfg, 'PROFILE.md')),
      'an unowned file was deleted — this removed by directory, not by manifest');
  } finally {
    sb.cleanup();
  }
});

// ---------------------------------------------------------------------------------------------
// `ExcludeWiringIsOwnershipTracked` (2), `TheGateDocumentIsWhatAHostHonours` (2) and
// `TheEntryRefusesRatherThanNoOps` (9) — the last thirteen.
//
// Eleven of them were per-implementation LOOPS whose Node arm was already absolute, so each
// crosses by keeping that arm and dropping the Python one. What is asserted did not change; what
// went away is a second process per case.

const run = (entry, argv, env, cwd) => spawnSync(process.execPath,
  [path.isAbsolute(entry) ? entry : path.join(ROOT, ...entry.split('/')), ...argv],
  { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** home + repo, with a claude install the exclude verb can find. */
function excludeWorld(sb) {
  const home = path.join(sb.path, 'home');
  const repo = path.join(sb.path, 'repo');
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  mkdirSync(repo, { recursive: true });
  writeFileSync(path.join(home, '.claude', '.geneseed-manifest.json'), '{"owned": []}\n', 'utf8');
  return { home, repo };
}

const excludesOf = (repo) => {
  const p = path.join(repo, '.claude', 'settings.local.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')).claudeMdExcludes ?? null;
};

test('exclude remove unwires what exclude add wired', () => {
  // The positive control, and it is not optional: without it the test below passes on an
  // implementation that never unwires anything at all.
  const sb = makeSandbox('hookcli-wire-');
  try {
    const { home, repo } = excludeWorld(sb);
    const env = cellEnv(home);
    assert.ok([0, 1].includes(run(CLI, ['exclude', 'add', repo], env, repo).status));
    assert.ok(excludesOf(repo), 'add wired nothing, so the removal below proves nothing');
    assert.ok([0, 1].includes(run(CLI, ['exclude', 'remove', repo], env, repo).status));
    assert.ok(!excludesOf(repo), 'remove left behind the claudeMdExcludes entry add wrote');
  } finally {
    sb.cleanup();
  }
});

test('exclude add does not claim wiring it found rather than created', () => {
  // The entry is present and OUR record of it is not — a project install's own wiring, or a hand
  // edit. Fabricating ownership there makes the next `remove` delete a line Geneseed never wrote.
  //
  // The precondition is reached BEHAVIOURALLY rather than by guessing the entry string: one `add`
  // creates both, then the install's `excludes.json` is deleted, which erases the record while
  // leaving the wiring in the repo exactly as another writer would have left it.
  const sb = makeSandbox('hookcli-own-');
  try {
    const { home, repo } = excludeWorld(sb);
    const env = cellEnv(home);
    run(CLI, ['exclude', 'add', repo], env, repo);
    const before = excludesOf(repo);
    assert.ok(before, 'add wired nothing, so this case has no precondition');
    rmSync(path.join(home, '.claude', 'excludes.json'));

    run(CLI, ['exclude', 'add', repo], env, repo);
    run(CLI, ['exclude', 'remove', repo], env, repo);
    assert.deepEqual(excludesOf(repo), before,
      'exclude add claimed ownership of a claudeMdExcludes entry it found rather than created, '
      + 'and the following remove deleted it');
  } finally {
    sb.cleanup();
  }
});

// `TheGateDocumentIsWhatAHostHonours` was ALREADY absolute against a literal, and that is its
// whole point: a cross-implementation comparison is structurally blind to a defect both sides
// share, so both could carry a typo'd `permissionDecison` key forever while every gate in every
// install silently stopped gating.
const GATE_DOCUMENT = {
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' },
};

function decision(argv, payload) {
  const r = spawnSync(process.execPath, [path.join(ROOT, ...HOOK.split('/')), ...argv],
    { cwd: ROOT, input: JSON.stringify(payload), encoding: 'utf8' });
  assert.equal(r.status, 0, 'a PreToolUse hook must exit 0 on every path — a non-zero one breaks '
    + `the tool call it was watching. stderr: ${r.stderr.slice(0, 300)}`);
  return JSON.parse(r.stdout);
}

for (const [verb, payload, law] of [
  ['git-gate', { tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }, 'Law XX'],
  ['rule-gate', { tool_name: 'Write', tool_input: { file_path: '/x/user-rules.md' } }, 'Law VI'],
]) {
  test(`${verb} emits the document the host reads`, () => {
    const got = decision([verb], payload);
    const { permissionDecisionReason, ...rest } = got.hookSpecificOutput;
    assert.deepEqual({ hookSpecificOutput: rest }, GATE_DOCUMENT);
    assert.ok(permissionDecisionReason.includes(law),
      `the reason does not cite ${law}: ${permissionDecisionReason}`);
  });
}

test('an unported verb refuses loudly', () => {
  // Every Geneseed hook returns 0 and signals through stdout, so a silent no-op and a success are
  // the SAME observation. The refusal is what makes the difference visible, and it names the
  // command that does work. `exclude` is the interesting one: a verb the SIBLING Node binary
  // answers, so "some Node entry handles it" is true while "this one does" must stay false — the
  // shim bakes exactly one of the two.
  for (const verb of ['doctor', 'build', 'status', 'uninstall', 'exclude']) {
    const r = run(HOOK, [verb], process.env, ROOT);
    assert.equal(r.status, 2, `${verb} must refuse with exit 2, got ${r.status}`);
    assert.ok(r.stderr.includes(`run \`geneseed ${verb}\``),
      `the refusal must name the command that does work, not merely repeat the verb: ${r.stderr}`);
    assert.equal(r.stdout, '',
      'a refusal must print nothing on stdout: that is the channel a host parses as a verdict');
  }
});

test('no verb at all refuses', () => {
  const r = run(HOOK, [], process.env, ROOT);
  assert.equal(r.status, 2, r.stderr.slice(0, 200));
  assert.equal(r.stdout, '');
});

test('two mutually exclusive theme flags are refused, and one of them is not', () => {
  // A mutually-exclusive group is BEHAVIOUR even though its wording is not reproduced, and the two
  // are separable — which is why this is a hand-written gate rather than a cell. A cell would
  // compare argparse's usage block against one line of the CLI entry and fail on text neither side
  // promises. What is promised is the refusal itself: both flavour flags together is an error, not
  // a silent pick of whichever the parser saw first.
  const sb = makeSandbox('hookcli-theme-');
  try {
    const env = cellEnv(path.join(sb.path, 'home'));
    const r = run(CLI, ['theme', 'mine', '--from', 'tokyonight', '--solid-only',
      '--transparent-only'], env, ROOT);
    assert.equal(r.status, 2, `both flavour flags were accepted: ${r.stdout.slice(0, 200)}`);
    assert.equal(r.stdout, '', 'it printed on stdout while refusing');
    // The positive control the reference got from its own second implementation: ONE of the flags
    // is accepted, so the refusal above is about the PAIR and not about the verb.
    const ok = run(CLI, ['theme', 'mine', '--from', 'tokyonight', '--solid-only',
      '--dir', sb.path], env, ROOT);
    assert.equal(ok.status, 0, ok.stderr.slice(0, 300));
    assert.ok(existsSync(path.join(sb.path, 'geneseed-mine.json')),
      'the accepted invocation wrote no theme, so the refusal is not about the pair');
  } finally {
    sb.cleanup();
  }
});

test('every newline the entry points write is the platform\'s', () => {
  // WHAT IS LEFT OF `test_the_two_entry_points_agree_on_stdout_BYTES`, and it is the one difference
  // the whole recorded matrix structurally cannot see: every cell reads stdout through a decoder
  // with universal newlines, so a hook printing CRLF and a hook printing LF are folded to the same
  // string before anything compares. That is not a gap in a cell — it is a property the harness's
  // own transport erases.
  //
  // The equality dies with the reference. The absolute residue is that the port writes the
  // PLATFORM's line ending, which is what the reference did through `sys.stdout` and what
  // `js/hooks.mjs`'s translating funnels and `withPyNewlines` were added to reproduce.
  //
  // THE SAME THREE ROWS, for the reasons the reference's docstring gives. `context` covers the
  // hooks. `prompt` is ~400 KB of rendered tree through a CLI module that could reach
  // `process.stdout.write` directly and leave the hook row green. `build` covers the generator's
  // ~25 raw print sites, which nothing could see until `build` started calling the driver's main
  // in-process. Counted, never sampled: a containment check is satisfied by one translated line in
  // a stream of untranslated ones.
  const sb = makeSandbox('hookcli-nl-');
  try {
    const home = path.join(sb.path, 'home');
    mkdirSync(home, { recursive: true });
    writeFileSync(path.join(sb.path, 'README.md'), '# bytes\n', 'utf8');
    const env = { ...cellEnv(home), GENESEED_OUT: path.join(sb.path, 'bundle') };
    const win = process.platform === 'win32';
    let total = 0;
    for (const [entry, argv] of [[HOOK, ['context', '--root', sb.path]],
      [CLI, ['prompt']], [CLI, ['build']]]) {
      const r = spawnSync(process.execPath,
        [path.join(ROOT, ...entry.split('/')), ...argv],
        { cwd: sb.path, env, maxBuffer: 256 * 1024 * 1024 });
      const out = r.stdout;
      assert.ok(out.length > 0,
        `${entry} ${argv[0]} printed nothing, so this row would pass on a silent implementation`);
      const lf = out.filter((b) => b === 0x0a).length;
      const crlf = out.filter((b, i) => b === 0x0a && out[i - 1] === 0x0d).length;
      total += lf;
      if (win) {
        assert.equal(lf - crlf, 0, `${entry} ${argv[0]} wrote ${lf - crlf} BARE line feeds of `
          + `${lf} — its output no longer goes through the os.linesep translation the reference's `
          + 'text layer applies, and no recorded cell can see it');
      } else {
        assert.equal(out.filter((b) => b === 0x0d).length, 0,
          `${entry} ${argv[0]} wrote carriage returns on a POSIX host`);
      }
    }
    assert.ok(total > 500, `only ${total} newlines across the three rows, so the rule above was `
      + 'asserted against almost nothing');
  } finally {
    sb.cleanup();
  }
});

test('the improvements filename is stamped the declared way', () => {
  // THE ASSERTION THE CELL HARNESS GAVE UP TO STOP BEING FLAKY. `diff --out` names its file after
  // the clock to the second, and a cell ran two implementations back to back — so a second
  // boundary between them reported a difference that was only time passing. The harness normalises
  // the filename out of the comparison, which buys stability and costs exactly one thing: with the
  // digits gone, nothing can say the FORMAT is right. `improvements-2026-08-09.md` would normalise
  // to the same token. A comparison made tolerant of a value owes an absolute assertion about that
  // value somewhere else, and this is it.
  const sb = makeSandbox('hookcli-impr-');
  try {
    const home = path.join(sb.path, 'home');
    const cfg = path.join(home, '.config', 'opencode');
    mkdirSync(cfg, { recursive: true });
    writeFileSync(path.join(cfg, '.geneseed-manifest.json'),
      JSON.stringify({ owned: ['AGENT.md'] }), 'utf8');
    writeFileSync(path.join(cfg, '.geneseed-theme'), 'neutral\n', 'utf8');
    writeFileSync(path.join(cfg, 'AGENT.md'), '# local\n', 'utf8');
    const r = run(CLI, ['diff', '--out'], cellEnv(home), sb.path);
    assert.equal(r.status, 0, r.stderr.slice(0, 400));
    const written = readdirSync(path.join(cfg, 'improvements'));
    assert.equal(written.length, 1, `wrote ${written} instead of one report`);
    assert.match(written[0], /^improvements-\d{8}-\d{6}\.md$/,
      'the improvements filename is stamped a different way than declared');
  } finally {
    sb.cleanup();
  }
});

test('the link shim names this runtime\'s own entry point', {
  skip: process.platform === 'win32' ? false
    : 'the .cmd shim is the Windows arm of `link`; the POSIX arm is tests/unit/link_shim.test.mjs',
}, () => {
  // THE DEBT THE SHIM'S STAMP OWES. `link` writes a `.cmd` whose one real line is
  // `"<runner>" "<entry>" %*`, and the harness normalises it — a normalisation with no absolute
  // assertion beside it is a value nothing gates. The negative half is the point: a shim naming
  // the OTHER runtime's entry point puts the wrong program on the user's PATH, and after the cut
  // there is no other runtime to name.
  const sb = makeSandbox('hookcli-link-');
  try {
    const home = path.join(sb.path, 'home');
    const bindir = path.join(home, 'AppData', 'Local', 'Geneseed', 'bin');
    // PATH is that bin dir and nothing else, so `link` takes its already-on-PATH branch — without
    // it this test would spawn PowerShell against the real user registry.
    const env = { ...cellEnv(home), PATH: bindir };
    const r = run(CLI, ['link'], env, sb.path);
    assert.equal(r.status, 0, r.stderr.slice(0, 400));
    assert.ok(r.stdout.includes('is on your user PATH'),
      'link did not take the already-on-PATH branch — this test would have written to the '
      + 'developer\'s own environment');
    const shim = readFileSync(path.join(bindir, 'geneseed.cmd'), 'utf8');
    const line = shim.split('\n').find((ln) => ln.trim().endsWith('%*'));
    assert.ok(line, `link wrote no argv line into the shim:\n${shim}`);
    const posix = line.replaceAll('\\', '/');
    assert.ok(posix.includes('bin/geneseed-cli.mjs'),
      'the shim does not name this runtime\'s own entry point');
    assert.ok(!posix.includes('harness.py'), 'the shim names the Python entry point');
    // The runner, absolutely: the shim must name the RUNNING binary by absolute path, never a
    // bare `node` that PATH could re-resolve.
    const runner = line.split('"')[1];
    assert.ok(path.isAbsolute(runner), `a relative runner was baked into the shim: ${runner}`);
  } finally {
    sb.cleanup();
  }
});

test('the install log names this runtime\'s own command', () => {
  // THE SAME DEBT IN A FILE. `command: <argv>` is persisted into the install log so a user can
  // re-run the step that failed, and the harness normalises the line for the same reason. The
  // negative half is why this is not "the tails match": a log naming a Python entry point tells a
  // user of a no-Python install to run a command they have no interpreter for.
  //
  // The failure is provoked the way the cell provokes it — an origin nothing can reach, in a
  // checkout copy this run may write to and the developer's may not.
  const sb = makeSandbox('hookcli-log-');
  try {
    const ck = path.join(sb.path, 'checkout');
    cloneCheckout(ck, 'origin=https://127.0.0.1:1/owner/repo.git', {});
    const log = path.join(sb.path, 'install.log');
    const env = {
      ...cellEnv(path.join(sb.path, 'home')),
      // The harness's own no-network pair: git refuses any transport but a local path before a
      // socket is opened, and never prompts for credentials.
      GIT_ALLOW_PROTOCOL: 'file',
      GIT_TERMINAL_PROMPT: '0',
      GENESEED_LOG: log,
      GENESEED_OUT: path.join(sb.path, 'bundle'),
    };
    const argv = repoint([process.execPath, path.join(ROOT, ...CLI.split('/'))], ck);
    const r = spawnSync(argv[0], [...argv.slice(1), 'bootstrap', '--no-setup'],
      { cwd: ck, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.equal(r.status, 1, 'the step was expected to FAIL — without a failed step nothing '
      + `writes a diagnosis at all\n${r.stdout.slice(-600)}`);
    const written = readFileSync(log, 'utf8');
    const line = written.split('\n').find((ln) => ln.startsWith('command: '));
    assert.ok(line, `no \`command:\` line in the install log:\n${written.slice(-600)}`);
    const posix = line.replaceAll('\\', '/');
    assert.ok(posix.includes('bin/geneseed-cli.mjs'),
      'the log does not name this runtime\'s own entry point');
    assert.ok(!posix.includes('harness.py'), 'the log names the Python entry point');
    assert.ok(line.trimEnd().endsWith(' upgrade'),
      `the recorded command does not end in the subcommand that ran: ${line}`);
  } finally {
    sb.cleanup();
  }
});

test('a mistyped flag is refused by the variadic sink', () => {
  // `bootstrap` is the one verb here with a variadic positional, and a sink that absorbed an
  // unknown OPTION would be the most dangerous parse bug in this entry point: `bootstrap
  // --no-setpu` would run an update AND a setup wizard while the user believes they asked for
  // neither.
  //
  // RUN INSIDE A `dirty` CLONE, belt and braces: the refusal must happen BEFORE anything
  // dispatches, and if it regressed the command it would run is an update — so it is pointed at a
  // throwaway checkout whose own preflight would refuse it anyway, never at the developer's.
  const sb = makeSandbox('hookcli-sink-');
  try {
    const ck = path.join(sb.path, 'checkout');
    cloneCheckout(ck, 'dirty', {});
    const env = {
      ...cellEnv(path.join(sb.path, 'home')),
      GIT_ALLOW_PROTOCOL: 'file',
      GIT_TERMINAL_PROMPT: '0',
    };
    const argv = repoint([process.execPath, path.join(ROOT, ...CLI.split('/'))], ck);
    const r = spawnSync(argv[0], [...argv.slice(1), 'bootstrap', 'main', '--no-setpu'],
      { cwd: ck, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.equal(r.status, 2,
      `a mistyped flag was not refused (exit ${r.status})\n${r.stdout.slice(-500)}`);
    assert.ok(r.stderr.includes('--no-setpu'), `the refusal does not name it: ${r.stderr}`);
    assert.ok(!r.stdout.includes('step 1/1'), 'the update step started before refusing');
  } finally {
    sb.cleanup();
  }
});

test('an emitted hook command shape runs through the shell', () => {
  // END TO END, through the real shell, with the `|| exit 0` a real emitted command carries — the
  // one path that exercises the QUOTING rather than the argv list.
  //
  // cwd is the install and not a scratch dir: `context` stands down silently when cwd is not a
  // project with docs, which is the exact shape of the disabled hook this exists to detect.
  const sb = makeSandbox('hookcli-shell-');
  try {
    const home = path.join(sb.path, 'home');
    mkdirSync(home, { recursive: true });
    writeFileSync(path.join(sb.path, 'README.md'), '# through the shell\n', 'utf8');
    const command = `"${process.execPath}" "${path.join(ROOT, ...HOOK.split('/'))}" `
      + `context --root "${sb.path}" || exit 0`;
    const r = spawnSync(command, { shell: true, cwd: sb.path, env: cellEnv(home),
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.equal(r.status, 0,
      `the emitted-shape command failed:\n  ${command}\n  stderr: ${r.stderr.slice(0, 300)}`);
    assert.ok(r.stdout.includes('# through the shell'),
      'the hook ran but injected nothing — these hooks signal through stdout, so a silent one is '
      + 'a disabled one');
  } finally {
    sb.cleanup();
  }
});
