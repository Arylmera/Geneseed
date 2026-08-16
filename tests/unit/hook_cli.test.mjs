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
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseArgs, resolveCli, selectCells } from '../cli_golden.mjs';
import { checkExpectations } from '../helpers/cli_golden.mjs';

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
  assert.deepEqual(sorted(covered.cli), sorted(verbsOf(CLI)),
    'the recorded cli cells and bin/geneseed-cli.mjs\'s verbs have diverged');
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
// written and passes. Nothing failed; `docs/port-ledger.md` row 5 said so in prose, and prose is
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
