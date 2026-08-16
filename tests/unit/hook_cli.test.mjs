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
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseArgs, resolveCli, selectCells } from '../cli_golden.mjs';
import { checkExpectations } from '../helpers/cli_golden.mjs';
import { cellEnv, makeSandbox } from '../helpers/sandbox.mjs';

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

/** PATH with every directory holding an interpreter removed, and what was removed. */
function pathWithoutPython() {
  const names = process.platform === 'win32'
    ? ['python.exe', 'python3.exe', 'py.exe'] : ['python', 'python3'];
  const kept = [];
  const dropped = [];
  for (const entry of (process.env.PATH ?? '').split(path.delimiter)) {
    if (entry && names.some((n) => existsSync(path.join(entry, n)))) dropped.push(entry);
    else kept.push(entry);
  }
  return { stripped: kept.join(path.delimiter), dropped };
}

/** A sandbox home plus the stripped PATH. The `dropped` guard is asserted by every caller. */
function strippedEnv(t, home) {
  const { stripped, dropped } = pathWithoutPython();
  // The vacuity guard: on a machine whose PATH never held a python, "it ran without one" is true
  // and meaningless.
  assert.ok(dropped.length > 0, 'PATH held no python at all, so this run proves nothing about '
    + 'whether the entry point would have found one');
  t.diagnostic(`${dropped.length} PATH entries held an interpreter and were removed`);
  return { ...cellEnv(home), PATH: stripped };
}

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
