/**
 * The generator driver's own gates — the ones a byte comparison structurally cannot give.
 *
 * SUCCESSOR TO `tests/test_node_cli_parity.py`, whose name was a misnomer its own docstring
 * disowned: only four of its seventeen tests ran the reference at all, and each of those four
 * carried an ABSOLUTE assertion about the reference which the comparison then propagated to the
 * port. Those four keep their job here and state the answer directly instead of asking a second
 * implementation for it — the measured answer is written at each one, taken from the reference
 * while it still existed. Nothing crossed as a comparison, and nothing needed to.
 *
 * WHY THIS FILE EXISTS AT ALL. `tests/golden.mjs` proves the emitted bytes; it cannot prove there
 * are two implementations. A `bin/build-driver.mjs` whose entire body was
 * `spawnSync('python', ['build.py', ...args])` would replay all 259 cells perfectly, because it
 * would BE the Python CLI. Everything below is some form of refutation of that, or of a flag no
 * cell passes.
 *
 * The refutation stays two-sided ON PURPOSE, because each side is blind where the other sees:
 *
 *   * The DYNAMIC half runs the driver with every Python REMOVED from PATH. It catches a spawn a
 *     static read would miss inside a disabled branch or behind an alias.
 *   * The STATIC half asserts the driver reaches no child-process module at all. It catches the
 *     spawn the dynamic half is blind to: an ABSOLUTE interpreter path, which never consults PATH
 *     and so never notices that PATH lost anything.
 *
 * The static half is the one test in this file that did NOT cross: `tests/unit/hook_cli.test.mjs`
 * already owns it, and owns it more strongly — the reference read `bin/build-driver.mjs`'s own source
 * and would have missed an import one module deep, where the surviving gate walks the transitive
 * closure. The delegation is asserted below rather than described, because a retirement whose
 * named gate can be deleted is prose.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseDriverArgs } from '../../bin/build-driver.mjs';
import { GENESEED_HOOK_SNIFF, SHIM_MARK } from '../../js/hosts/settings.mjs';
import { walkFiles } from '../helpers/golden.mjs';
import { cellEnv, makeSandbox, strippedEnv } from '../helpers/sandbox.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DRIVER = path.join(ROOT, 'bin', 'build-driver.mjs');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

/**
 * The nine `--emit` choices, FROZEN HERE rather than imported from the driver.
 *
 * The reference kept its own copy for the same reason and said so: reading the contract out of
 * the implementation under test would let both drift together. `build.py:337-338` was the second
 * party then; with it gone this literal is, which is a real weakening and is the honest one —
 * `the driver classifies every emit` below is what re-joins the copy to the source.
 */
const EMITS = ['files', 'opencode', 'opencode-global', 'claude', 'claude-global',
  'bob', 'bob-global', 'copilot', 'copilot-global'];

/**
 * The driver's flag surface, frozen, and the same argument applies with more force.
 *
 * `test_the_help_text_names_every_flag_the_reference_takes` scraped `build.py`'s `add_argument`
 * calls precisely so that a flag added to one side alone would fail. That second party is gone,
 * and `usage()` renders straight out of `VALUED`/`FLAGS` — so a gate scraped from the driver
 * would agree with the driver by construction and assert nothing at all.
 *
 * So this table IS the second party: hand-maintained, and checked in three directions below —
 * against the parse tables in the source (a flag added to neither this table nor the help text
 * fails), against `parseDriverArgs` (each flag is really accepted, and binds the dest named
 * here), and against the rendered help (each flag is really printed).
 */
const VALUED_FLAGS = [
  ['--theme', 'theme', 'neutral'],
  ['--posture', 'posture', 'peer'],
  ['--mode', 'mode', 'direct'],
  // The one row whose dest is not the string that was typed: `--doctrines` takes a comma LIST
  // and binds the parsed pack array, so the row carries both forms. A two-pack value, not one:
  // a single name would parse to a one-element array and leave the comma split untested.
  ['--doctrines', 'doctrines', 'craft,rigor', ['craft', 'rigor']],
  // The second doctrine axis, and the second row whose parsed form differs from what was
  // typed. `process 7` — the SPACED spelling, which is how the marker and the CLI's own error
  // message write an address — must bind the dotted one, or a value copied off a carrier is
  // rejected by the flag that wrote it.
  ['--exclude-rules', 'excludeRules', 'process 7,craft 2', ['craft.2', 'process.7']],
  ['--out', 'out', 'Elsewhere'],
  // The alias, and the one row a set-equality alone could not state: `--target` binds `out`.
  ['--target', 'out', 'Elsewhere'],
  ['--emit', 'emit', 'files'],
  ['--footprint', 'footprint', 'lean'],
  ['--root', 'root', 'Repo'],
];
const BARE_FLAGS = [
  ['--sync-themes', 'syncThemes'],
  ['--validate-only', 'validateOnly'],
  ['-v', 'verbose'],
  ['--verbose', 'verbose'],
];

const runDriver = (argv, env = process.env, cwd = ROOT) => spawnSync(
  process.execPath, [DRIVER, ...argv],
  { cwd, env, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
);

/** A sandbox with `home/` already made — the shape every emit below runs in. */
function emitSandbox(prefix) {
  const sb = makeSandbox(prefix);
  const home = path.join(sb.path, 'home');
  mkdirSync(home, { recursive: true });
  return { sb, home, env: cellEnv(home) };
}

/**
 * The hook command for `verb`, out of whatever settings file an emit just wrote.
 *
 * READ, never reconstructed: a check that rebuilt `"<shim>" git-gate --root "<cfg>"` from parts
 * would still pass if the emitter stopped writing that command at all.
 *
 * The WHOLE sandbox is searched rather than a fixed `<out>/.claude/settings.local.json`, because
 * the four hook-writing emits do not agree on where it lands — bob's is under `.bob/`, and the
 * two globals write into the config dirs `cellEnv` redirects into the sandbox home, not into
 * `--out` at all.
 */
function emittedHookCommand(sandbox, verb) {
  const commands = [];
  for (const p of walkFiles(sandbox)) {
    const name = path.basename(p);
    if (!name.startsWith('settings') || !name.endsWith('.json')) continue;
    let data;
    try { data = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
    for (const groups of Object.values(data.hooks ?? {})) {
      for (const g of groups ?? []) {
        for (const h of g.hooks ?? []) {
          if (h && typeof h === 'object' && typeof h.command === 'string') commands.push(h.command);
        }
      }
    }
  }
  assert.ok(commands.length > 0, `no settings file under ${sandbox} carries a hook command`);
  const picked = commands.filter((c) => c.includes(verb));
  assert.ok(picked.length > 0,
    `no emitted hook command carries ${JSON.stringify(verb)}: ${commands.join(' | ')}`);
  return picked[0];
}

/** One emitted hook command, run exactly as a host would: through the shell, `|| exit 0` intact. */
const runHook = (command, cwd, env, input = '') => spawnSync(command,
  { shell: true, cwd, env, input, encoding: 'utf8', windowsHide: true });

const shimsUnder = (sandbox) => walkFiles(sandbox)
  .filter((p) => path.basename(p).startsWith(SHIM_MARK));

// ---------------------------------------------------------------------------------------------
// THE PASSTHROUGH REFUTATION

test('the driver builds with no python reachable on PATH', (t) => {
  // DYNAMIC. A passthrough driver's `spawn('python', …)` fails with ENOENT and the emit dies; a
  // real Node driver never notices. `node` itself is invoked by absolute path, so stripping PATH
  // cannot take the runtime out from under the test.
  const { sb, home } = emitSandbox('driver-nopy-');
  try {
    const out = path.join(sb.path, 'out');
    const r = runDriver(['--theme', 'neutral', '--emit', 'files', '--footprint', 'lean',
      '--out', out], strippedEnv(t, home));
    assert.equal(r.status, 0,
      'bin/build-driver.mjs failed with no python on PATH — it is driving the Python CLI rather than '
      + `being a second implementation of it. stderr: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
    assert.ok(existsSync(path.join(out, 'AGENT.md')),
      'no bundle was produced with python off PATH');
  } finally {
    sb.cleanup();
  }
});

test('the static half of the refutation is gated by the walk that superseded it', () => {
  // RETIREMENT, MADE CHECKABLE. `test_the_driver_imports_no_child_process_module` read
  // `bin/build-driver.mjs`'s own source for three banned specifiers — which a single
  // `import … from '../../js/hosts/hooks.mjs'` would have walked straight past, leaving child_process in
  // the driver's process with the driver's own source still clean. The gate named here walks the
  // transitive import closure instead, so it is the same claim strictly enlarged, and pointing at
  // it is only worth anything if the pointer is checked.
  const owner = read('tests', 'unit', 'hook_cli.test.mjs');
  assert.ok(owner.includes("test('the generator driver still reaches no child-process module'"),
    'the transitive import walk that replaced the reference\'s flat source read is no longer in '
    + 'tests/unit/hook_cli.test.mjs — the static half of the passthrough refutation is now '
    + 'ungated and this file only claims otherwise');
});

// ---------------------------------------------------------------------------------------------
// THE DRIVER'S SURFACE

test('the driver classifies every emit', () => {
  // The partition, re-derived from the source. `PORTED` had two spellings across the port — a
  // literal subset while it was partial, `new Set(EMITS)` now that all nine have crossed — and
  // following the alias is what keeps this honest.
  const text = read('bin', 'build-driver.mjs');
  const listed = jsStringList(text, 'const EMITS = [');
  assert.deepEqual([...listed].sort(), [...EMITS].sort(),
    'bin/build-driver.mjs offers a different set of --emit choices than this file freezes; a tenth '
    + 'emit needs a row here and a cell of its own somewhere');
  const ported = text.includes('const PORTED = new Set(EMITS)')
    ? listed : jsStringList(text, 'const PORTED = new Set([');
  assert.deepEqual([...ported].sort(), [...EMITS].sort(),
    `--emit ${[...EMITS].filter((e) => !ported.has(e)).join(', ')} has not crossed; each must `
    + 'refuse with exit 3 and this file needs the cell the reference carried for exactly that');

  // WHAT THIS CANNOT REACH, STATED RATHER THAN LEFT AS A GREEN. With `PORTED` equal to `EMITS`,
  // the driver's `if (!PORTED.has(args.emit)) die(3, …)` is unreachable for any value that got
  // past `choice`, so the reference's exit-3 loop ran zero times too. The reachable neighbour is
  // the choice refusal one layer up, and that IS exercised — a value in neither list.
  const r = runDriver(['--emit', 'no-such-host', '--out', 'X']);
  assert.equal(r.status, 2, `--emit no-such-host was not refused: ${r.stdout.slice(0, 200)}`);
  assert.match(r.stderr, /argument --emit: invalid choice: 'no-such-host'/);
});

/** The quoted tokens of a JS array literal opened by `marker`. */
function jsStringList(text, marker) {
  const i = text.indexOf(marker);
  assert.notEqual(i, -1, `bin/build-driver.mjs no longer contains ${JSON.stringify(marker)}`);
  const body = text.slice(i + marker.length, text.indexOf(']', i));
  return new Set([...body.matchAll(/'([^']+)'/g)].map((m) => m[1]));
}

test('--sync-themes runs here, and --validate-only points at the other binary', () => {
  // The two maintainer flags, and the split is the shape of the port's answer to them. Both used
  // to refuse with exit 2 naming `python build.py`.
  const themes = path.join(ROOT, 'themes');
  const before = new Map(walkFiles(themes).filter((p) => p.endsWith('.json'))
    .map((p) => [p, readFileSync(p)]));
  assert.ok(before.size > 0, 'no theme files were read, so the no-op assertion below is vacuous');

  // `--sync-themes` needs nothing this driver may not have, so it RUNS. On an in-sync checkout
  // that is a no-op with exit 0 — which is also the safety property worth asserting: the tool
  // that rewrites committed files must write nothing when there is nothing to write.
  const sync = runDriver(['--sync-themes']);
  assert.equal(sync.status, 0,
    '--sync-themes on an in-sync checkout must be a no-op with exit 0; got '
    + `${sync.status}. stderr: ${sync.stderr.trim().slice(0, 300)}`);
  assert.match(sync.stdout, /all themes already carry every template key\./);
  for (const [p, bytes] of before) {
    assert.deepEqual(readFileSync(p), bytes,
      `--sync-themes rewrote ${path.relative(ROOT, p)} on an already-in-sync checkout`);
  }

  // `--validate-only` CANNOT run here: its second half is the doctor and the doctor starts a
  // process. So it refuses, and what its refusal must name is the CLI VERB that does the work —
  // never an interpreter.
  const val = runDriver(['--validate-only']);
  assert.equal(val.status, 2, `--validate-only should exit 2, got ${val.status}`);
  assert.match(val.stderr, /geneseed validate/,
    '--validate-only\'s refusal must name the verb that does the work');
  assert.doesNotMatch(val.stderr, /python|build\.py/,
    '--validate-only\'s refusal points the user at an interpreter or at the deleted reference');
});

test('--root prefixes the instruction path the config records', () => {
  // THE AXIS THE MATRIX CANNOT REACH. `argvFor` builds `--theme/--emit/--footprint/--out` plus an
  // optional `--posture`/`--mode` and nothing else, so `out === root` in all 259 cells and the
  // relative prefix is `''` every time. The instruction-path prefix `opencode.json` records — the
  // whole reason the flag exists — is therefore INDISTINGUISHABLE to the acceptance test.
  //
  // Written as a PARTITION rather than as the reference's containment: with `--root` the config
  // lands at the root carrying `Harness/AGENT.md`, without it beside the bundle carrying
  // `AGENT.md`. A port that derived one value from the other passes either half alone.
  for (const [withRoot, wantPath, wantInstruction] of [[true, 'repo', 'Harness/AGENT.md'],
    [false, 'out', 'AGENT.md']]) {
    const { sb, env } = emitSandbox('driver-root-');
    try {
      const repo = path.join(sb.path, 'repo');
      const out = withRoot ? path.join(repo, 'Harness') : path.join(sb.path, 'out');
      const argv = ['--theme', 'neutral', '--emit', 'opencode', '--footprint', 'lean',
        '--out', out];
      if (withRoot) argv.push('--root', repo);
      const r = runDriver(argv, env);
      assert.equal(r.status, 0, `emit failed: ${(r.stderr || r.stdout).slice(0, 400)}`);

      const config = path.join(sb.path, wantPath, 'opencode.json');
      assert.ok(existsSync(config),
        `--root ${withRoot ? 'moved' : 'did not place'} opencode.json where the host reads it, `
        + `expected ${config}`);
      assert.deepEqual(JSON.parse(readFileSync(config, 'utf8')).instructions, [wantInstruction],
        `opencode.json records the wrong instruction path with --root ${withRoot ? 'set' : 'unset'}`);
      assert.ok(r.stdout.includes(`instructions: ${wantInstruction}`),
        `the emit reported a different instruction path than it wrote: ${r.stdout.slice(0, 300)}`);
    } finally {
      sb.cleanup();
    }
  }
});

test('a non-ASCII target path is escaped in the registry', () => {
  // `json.dumps` defaults to `ensure_ascii=True`; `JSON.stringify` does not. Every JSON document
  // this driver writes has to escape non-ASCII the way the reference did. The manifest writer got
  // this wrong for a whole phase and no cell could tell: the only manifest being written was the
  // per-repo OpenCode one, whose `_comment` is pure ASCII.
  //
  // `installs.json` is the same hazard, and it holds absolute PATHS — ASCII in every golden cell,
  // and not ASCII on a machine whose user name has an accent.
  //
  // THE ABSOLUTE ANSWER, MEASURED FROM THE REFERENCE WHILE IT EXISTED: python wrote
  // `d\u00e9p\u00f4t-caf\u00e9`, and the file it wrote had no byte above 0x7F anywhere in it. The
  // second half is the general property and the reference never asserted it.
  const { sb, home, env } = emitSandbox('driver-uni-');
  try {
    const repo = path.join(sb.path, 'd\u00e9p\u00f4t-caf\u00e9');
    // The control: a cell whose path is ASCII after all proves nothing about escaping.
    assert.ok(/[^\u0000-\u007f]/.test(repo), 'the target path is ASCII, so this cell is vacuous');
    const r = runDriver(['--theme', 'neutral', '--emit', 'opencode', '--footprint', 'lean',
      '--out', repo], env);
    assert.equal(r.status, 0, `emit failed: ${(r.stderr || r.stdout).slice(0, 400)}`);

    const reg = path.join(home, '.config', 'geneseed', 'installs.json');
    assert.ok(existsSync(reg),
      'no install registry was written, so this cell proves nothing about how one is encoded');
    const raw = readFileSync(reg);
    assert.ok(raw.includes('d\\u00e9p\\u00f4t-caf\\u00e9'),
      `the registry does not escape the non-ASCII path the way python did: ${raw.toString('utf8')}`);
    assert.equal(raw.find((b) => b > 0x7f), undefined,
      `the registry carries a raw non-ASCII byte; ensure_ascii means the whole document, not the `
      + `one path this cell planted: ${raw.toString('utf8')}`);
  } finally {
    sb.cleanup();
  }
});

test('every relocation var moves its global target, and Claude\'s does not', () => {
  // NO GOLDEN CELL CAN CHECK THIS, and the reason is a safety measure: `cellEnv` deliberately
  // CLEARS every relocation variable, because leaving one set sends ~126 global cells into the
  // developer's real install. So the matrix runs with the vars unset, and a driver that ignored
  // one would be byte-identical in all 259 cells while writing into the user's real config dir on
  // every machine that exports it — which is the documented way to keep a harness in a
  // git-tracked folder.
  //
  // A TABLE because it was once one row: the first version covered `$OPENCODE_CONFIG_DIR` alone,
  // and when the Copilot pair crossed, a mutation that ignored `$COPILOT_CONFIG_DIR` passed every
  // gate in the repo. The prose describing the hazard had been generalised to the new host; the
  // gate had not.
  //
  // CLAUDE IS THE INVERSE ROW, and it is why there is a `moves` column instead of one fewer
  // entry. `claudeConfigDir` has NO env branch BY DESIGN — Claude Code documents no such variable
  // — so for that host the property is the opposite one: the variable a reader would reach for
  // must NOT move the target. Expressed as absence, the table could not tell a deliberate design
  // from a forgotten host, which is exactly what the `covered` cross-check catches.
  const hosts = [
    ['OPENCODE_CONFIG_DIR', true, 'opencode-global', 'AGENT.md', path.join('.config', 'opencode')],
    ['COPILOT_CONFIG_DIR', true, 'copilot-global', 'copilot-instructions.md', '.copilot'],
    // `rules/geneseed.md`, not AGENTS.md: Bob never auto-loads a global AGENTS.md, so the global
    // emit deliberately writes none and puts the preamble in its always-injected rules folder.
    // The first version of this row named AGENTS.md and failed — the table caught its own author.
    ['BOB_CONFIG_DIR', true, 'bob-global', path.join('rules', 'geneseed.md'), '.bob'],
    ['CLAUDE_CONFIG_DIR', false, 'claude-global', 'CLAUDE.md', '.claude'],
  ];
  assert.deepEqual(hosts.map((h) => h[2]).sort(), EMITS.filter((e) => e.endsWith('-global')).sort(),
    'a global emit has no relocation-var row (or this table names one that is not an emit) — that '
    + 'is exactly the omission this table exists to make visible');

  for (const [name, moves, emit, marker, defaultRel] of hosts) {
    const { sb, home, env } = emitSandbox('driver-reloc-');
    try {
      const relocated = path.join(sb.path, 'relocated-config');
      const r = runDriver(['--theme', 'neutral', '--emit', emit, '--footprint', 'lean',
        '--out', path.join(sb.path, 'legacy')], { ...env, [name]: relocated });
      assert.equal(r.status, 0, `${emit} failed: ${(r.stderr || r.stdout).slice(0, 300)}`);
      const atRelocated = existsSync(path.join(relocated, marker));
      const atDefault = existsSync(path.join(home, defaultRel, marker));
      if (moves) {
        assert.ok(atRelocated, `the driver ignored $${name} — it would render into the user's real `
          + `~/${defaultRel.split(path.sep).join('/')} on every machine that sets it`);
        assert.ok(!atDefault, `the driver wrote to the DEFAULT config dir as well as the one `
          + `$${name} names`);
      } else {
        assert.ok(atDefault, `${emit} did not render into ~/${defaultRel}`);
        assert.ok(!atRelocated, `the driver honoured $${name}, which does not exist for this host `
          + '— the resolver has no env branch at all, so an install would land somewhere no other '
          + 'Geneseed verb goes looking for it');
      }
    } finally {
      sb.cleanup();
    }
  }
});

test('a global emit warns about registered project installs, and prunes as it reads', () => {
  // A TWO-STEP SEQUENCE THE MATRIX CANNOT EXPRESS. Both stacking warnings read the install
  // registry, so they speak only when a PROJECT install of that host is already on record. Every
  // golden cell emits into a fresh sandbox whose registry is empty, so the warning is UNREACHABLE
  // in all 259 of them — including the whole registry read path, which is where the prune-on-read
  // that rewrites `installs.json` lives.
  //
  // THREE SEEDED ROWS, each because a mutation survived without it: the project install of the
  // host under test (the row the warning is about); an `opencode` project install (a live row
  // with a DIFFERENT marker — with only the first row present, a survivor scan that ignored the
  // marker returned the same single root and said the same thing); and a row pointing at a
  // directory that no longer exists (without it `kept` equals the original list, the prune never
  // writes, and dropping the write is invisible).
  //
  // A TABLE for the same reason the relocation one is: written for Copilot alone, it would have
  // covered Bob's later warning with nothing at all.
  const hosts = [['copilot', 'copilot-global', 'COPILOT_CONFIG_DIR', 'Copilot'],
    ['bob', 'bob-global', 'BOB_CONFIG_DIR', 'Bob']];
  for (const [project, globalEmit, varName, word] of hosts) {
    const { sb, home, env: base } = emitSandbox('driver-stack-');
    try {
      const env = { ...base, [varName]: path.join(sb.path, 'host-cfg') };
      const repo = path.join(sb.path, 'repo');
      const ocRepo = path.join(sb.path, 'oc-repo');
      const emit = (argv) => {
        const r = runDriver(['--theme', 'neutral', '--footprint', 'lean', ...argv], env);
        assert.equal(r.status, 0, `${argv[1]} failed: ${(r.stderr || r.stdout).slice(0, 300)}`);
        return r;
      };
      emit(['--emit', project, '--out', repo]);
      emit(['--emit', 'opencode', '--out', ocRepo]);

      // The dead row, added after the live ones so the prune has something to do.
      const reg = path.join(home, '.config', 'geneseed', 'installs.json');
      const dead = path.join(sb.path, 'deleted-install');
      const rows = JSON.parse(readFileSync(reg, 'utf8'));
      assert.deepEqual(rows, [repo, ocRepo],
        'the two project emits did not register the roots this cell is about');
      writeFileSync(reg, `${JSON.stringify(rows.concat([dead]), null, 2)}\n`, 'utf8');

      const r = emit(['--emit', globalEmit, '--out', path.join(sb.path, 'legacy')]);
      // THE ABSOLUTE ANSWERS, measured from the reference while it existed.
      assert.ok(r.stderr.includes(`project ${word} install(s) already exist`),
        `--emit ${globalEmit} said nothing about the project install already on record:\n`
        + `  ${r.stderr.slice(0, 400)}`);
      assert.ok(r.stderr.includes(`1 project ${word} install(s)`),
        'the warning counted something other than the single root of its own host — the opencode '
        + `row is supposed to be filtered out by its marker:\n  ${r.stderr.slice(0, 400)}`);
      assert.ok(r.stderr.includes(repo),
        `the warning does not name the install it is about:\n  ${r.stderr.slice(0, 400)}`);
      assert.ok(!r.stderr.includes(ocRepo),
        `the warning names the opencode install, whose marker is not ${word}'s:\n`
        + `  ${r.stderr.slice(0, 400)}`);

      assert.deepEqual(JSON.parse(readFileSync(reg, 'utf8')), [repo, ocRepo],
        'the dead row survived the read, or a live one did not: the prune-on-read is a WRITE and '
        + 'it is the part of this path most likely to be wrong');
    } finally {
      sb.cleanup();
    }
  }
});

// ---------------------------------------------------------------------------------------------
// THE EMITTED HOOKS, EXECUTED

test('the emitted hook shim answers the gate it bakes', () => {
  // `shimHealth` requires the shim's quoted paths to EXIST, which refuses `"undefined"` and
  // nothing else — a shim naming a real file that cannot answer a verb is a silently disabled
  // hook, because every Geneseed hook returns 0 and signals through stdout, so "did nothing" and
  // "worked" are the same observation. So this takes the git-gate command out of the settings
  // file the driver just wrote, runs it through the shell with the payload a host sends, and
  // requires the verdict document back.
  //
  // git-gate rather than `context`: it is the verb whose entire output is a JSON document on
  // stdout, so a truncated or polluted stream fails here and merely looks quiet there.
  const { sb, env } = emitSandbox('driver-shim-');
  try {
    const out = path.join(sb.path, 'out');
    const r = runDriver(['--theme', 'neutral', '--emit', 'claude', '--footprint', 'lean',
      '--out', out], env);
    assert.equal(r.status, 0, `claude emit failed: ${(r.stderr || r.stdout).slice(0, 400)}`);

    const shims = shimsUnder(sb.path);
    assert.ok(shims.length > 0, 'the driver wired hooks but wrote no shim');
    const command = emittedHookCommand(sb.path, ' git-gate ');
    assert.ok(command.includes(shims[0]),
      'the emitted git-gate command does not go through the shim this driver wrote, so running it '
      + `proves nothing about the shim:\n  ${command}`);

    const proc = runHook(command, out, env, JSON.stringify(
      { tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }));
    assert.equal(proc.status, 0,
      `the emitted git-gate command failed to run:\n  ${command}\n`
      + `  stderr: ${(proc.stderr ?? '').trim().slice(0, 300)}`);
    assert.match(proc.stdout ?? '', /"permissionDecision"/,
      `the shim ran but git-gate produced no verdict document — the gate is disabled and nothing `
      + `else would report it:\n  ${command}\n  stdout: ${(proc.stdout ?? '').slice(0, 300)}`);
  } finally {
    sb.cleanup();
  }
});

test('an emitted hook command actually runs, and is silent where it should be', () => {
  // Everything else about hooks is checked structurally — settings.json is compared byte for
  // byte, the shim is asserted to exist and to name existing files. None of that executes
  // anything, and a hook that runs but answers nothing is invisible to all of it.
  const { sb, env } = emitSandbox('driver-hookrun-');
  try {
    const out = path.join(sb.path, 'out');
    const r = runDriver(['--theme', 'neutral', '--emit', 'claude', '--footprint', 'lean',
      '--out', out], env);
    assert.equal(r.status, 0, `claude emit failed: ${(r.stderr || r.stdout).slice(0, 400)}`);

    // The SessionStart/`context` one: it reads the install and prints its verdict, the fullest of
    // the four paths, and it needs no tool payload on stdin.
    const command = emittedHookCommand(sb.path, ' context ');
    // cwd is the INSTALL, and that is load-bearing rather than tidiness — see the control below.
    const proc = runHook(command, out, env);
    assert.equal(proc.status, 0,
      `an emitted hook command failed to run:\n  ${command}\n`
      + `  stderr: ${(proc.stderr ?? '').trim().slice(0, 300)}`);
    assert.ok((proc.stdout ?? '').trim().length > 0,
      'the emitted hook ran but printed nothing — Geneseed\'s hooks signal through stdout, so a '
      + `silent one is a disabled one:\n  ${command}`);

    // THE CONTROL, and it is what makes the assertion above mean anything. The context hook
    // stands down silently when cwd is not a Geneseed install (project-bypasses-global), so run
    // from anywhere else it exits 0 with an empty stdout — the exact shape of the disabled hook
    // this test exists to detect. Measured, after the reference's first version failed that way.
    const elsewhere = runHook(command, sb.path, env);
    assert.equal(elsewhere.status, 0, 'the context hook must stand down quietly, not fail');
    assert.equal((elsewhere.stdout ?? '').trim(), '',
      'the context hook spoke from a directory that is not an install, so "it printed something" '
      + 'above is not evidence that it found the install');
  } finally {
    sb.cleanup();
  }
});

test('a hook-writing emit needs no python at all', (t) => {
  // THE EXACT INVERSE OF THE CELL THAT STOOD HERE. Through P4e the four Claude-shaped emits had
  // to REFUSE with exit 4 when no interpreter was discoverable, because the hooks they wired were
  // Python and a shim naming an absent interpreter disables every hook in an install silently.
  // The four verbs those hooks invoke are Node now and the shim bakes
  // `<node> <checkout>/bin/geneseed-hook.mjs`, so the required outcome flips: the emit must
  // SUCCEED, and its hooks must still work.
  //
  // Same fixture as the passthrough refutation, deliberately, so the three outcomes this
  // environment has to produce sit in one measured world rather than three convenient ones.
  // Emitting is the weaker half: the strong half is running the emitted git-gate command with
  // that same PATH, which is what catches a hook path reaching back for Python anywhere along it.
  for (const emit of ['claude', 'claude-global', 'bob', 'bob-global']) {
    const { sb, home } = emitSandbox('driver-nopy-hooks-');
    try {
      const env = strippedEnv(t, home);
      const r = runDriver(['--theme', 'neutral', '--emit', emit, '--footprint', 'lean',
        '--out', path.join(sb.path, 'out')], env);
      assert.equal(r.status, 0,
        `--emit ${emit} with no python on PATH must succeed, got ${r.status}. `
        + `stderr: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);

      // Bob wires the two gates as ONE `tool-gate` group; Claude wires `git-gate` by matcher.
      const bob = emit.startsWith('bob');
      const command = emittedHookCommand(sb.path, bob ? ' tool-gate ' : ' git-gate ');
      const proc = runHook(command, sb.path, env, JSON.stringify(
        { tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }));
      assert.equal(proc.status, 0,
        `the hook ${emit} emitted failed to run with no python on PATH:\n  ${command}\n`
        + `  stderr: ${(proc.stderr ?? '').trim().slice(0, 300)}`);
      // The verdict is spoken in the host's dialect: Claude's `permissionDecision: "ask"` on
      // stdout; Bob's consent nudge is a stderr line (its PreToolUse never reads stdout).
      // Either is a hook that RAN.
      assert.match(bob ? (proc.stderr ?? '') : (proc.stdout ?? ''),
        bob ? /process 5/ : /"permissionDecision"/,
        `the hook ${emit} emitted ran with no python on PATH but produced no verdict — it is `
        + `disabled, and nothing else reports that:\n  ${command}\n`
        + `  stdout: ${(proc.stdout ?? '').slice(0, 300)}`);
    } finally {
      sb.cleanup();
    }
  }
});

test('the pre-shim fallback command is still recognisable as geneseed', () => {
  // THE COINCIDENCE P5b MADE LOAD-BEARING. `hookPrefix` falls back to `"<runner>" "<entry>"` when
  // the shim cannot be written, and `GENESEED_HOOK_SNIFF` is how `unlink`, `uninstall` and the
  // orphan scan tell a Geneseed hook from a user's. The reference driver's entry ended in
  // `harness.py` and matched the first marker. This driver's ends in `bin/geneseed-hook.mjs`,
  // which matches the SECOND marker only because the file was named after the shim: `SHIM_MARK`
  // is `geneseed-hook` and the marker lives in the FILENAME. Nothing asserted that, and the cost
  // of it silently ceasing to hold is a hook no cleanup path can find.
  //
  // The fallback is reached BEHAVIOURALLY rather than by reading the source: point
  // `$GENESEED_HOME` at a regular FILE, so the mkdir under it fails with ENOTDIR and the shim
  // write returns null.
  const { sb, env: base } = emitSandbox('driver-fallback-');
  try {
    const blocker = path.join(sb.path, 'not-a-dir');
    writeFileSync(blocker, '', 'utf8');
    const env = { ...base, GENESEED_HOME: blocker };
    const r = runDriver(['--theme', 'neutral', '--emit', 'claude', '--footprint', 'lean',
      '--out', path.join(sb.path, 'out')], env);
    assert.equal(r.status, 0, `claude emit failed: ${(r.stderr || r.stdout).slice(0, 400)}`);

    // THE VACUITY GUARD HAS TO BE THE ABSENCE OF THE SHIM FILE, not the absence of its name in
    // the command: the fallback names `bin/geneseed-hook.mjs`, which contains `SHIM_MARK` — which
    // is the very coincidence under test.
    const written = shimsUnder(sb.path);
    assert.deepEqual(written, [],
      `a shim was written after all, so this cell never reached the fallback: ${written}`);

    const command = emittedHookCommand(sb.path, ' git-gate ');
    assert.ok(GENESEED_HOOK_SNIFF.some((m) => command.includes(m)),
      `the pre-shim fallback command carries none of ${GENESEED_HOOK_SNIFF.join(', ')}, so no `
      + `cleanup path can recognise the hooks this driver emitted:\n  ${command}`);
  } finally {
    sb.cleanup();
  }
});

test('VERIFY reports an orphaned geneseed hook, and says nothing without one', () => {
  // VERIFY IS SILENT ON SUCCESS, which is its own kind of coverage hole. The settings-integrity
  // check runs on every Claude-shaped emit and prints only when it finds a fault. Every golden
  // cell is clean, so it prints nothing in all 259 of them — which means DELETING the call is
  // byte-identical across the entire acceptance matrix. Not unreachable, and not
  // indistinguishable-by-fixture in the earlier senses: its whole output is conditional on a
  // fault no cell creates.
  //
  // So this creates one. A user-authored hook whose command matches a sniff marker but sits in no
  // recorded claim group is exactly what the orphan scan exists to report, and it survives the
  // merge, which only prunes groups it RECORDED.
  const { sb, env } = emitSandbox('driver-orphan-');
  try {
    const out = path.join(sb.path, 'repo');
    const emit = () => {
      const r = runDriver(['--theme', 'neutral', '--emit', 'claude', '--footprint', 'lean',
        '--out', out], env);
      assert.equal(r.status, 0, `claude emit failed: ${(r.stderr || r.stdout).slice(0, 300)}`);
      return r;
    };
    emit();
    // THE CONTROL THE COMPARISON DID NOT NEED AND AN ABSOLUTE ASSERTION DOES: a re-emit over a
    // clean install must say nothing at all. Without it, "the planted hook made it speak" is
    // equally satisfied by a check that speaks on every run.
    assert.equal(emit().stderr, '',
      'a re-emit over a clean install printed a warning, so the orphan report below is not '
      + 'evidence that the scan found the hook this cell planted');

    const sf = path.join(out, '.claude', 'settings.local.json');
    const data = JSON.parse(readFileSync(sf, 'utf8'));
    data.hooks ??= {};
    (data.hooks.Stop ??= []).push({
      matcher: '*',
      hooks: [{ type: 'command', command: '"python" "/elsewhere/harness.py" learn' }],
    });
    writeFileSync(sf, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

    const said = emit().stderr;
    assert.ok(said.includes('Geneseed-pattern hook present but NOT recorded'),
      `the planted hook did not make VERIFY speak, so nothing here says the stage runs at all:\n`
      + `  ${said.slice(0, 400)}`);
    assert.ok(said.includes("event='Stop'"),
      `VERIFY spoke but did not name the event the orphan is filed under:\n  ${said.slice(0, 400)}`);
  } finally {
    sb.cleanup();
  }
});

test('the footprint default is the flag\'s, not the function signature\'s', () => {
  // The reference's flag defaulted to `lean` while every emit SIGNATURE defaulted to `full`. A
  // driver that reproduced the signature default emits a different harness in every cell, and
  // every gate that calls the emit functions directly stays green — so the marker is read back
  // here rather than trusted to the byte comparison alone.
  const { sb, env } = emitSandbox('driver-footprint-');
  try {
    const out = path.join(sb.path, 'out');
    const r = runDriver(['--theme', 'neutral', '--out', out], env);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(path.join(out, '.geneseed-footprint'), 'utf8').trim(), 'lean');
    // …and the parser agrees with the file, which is what says the marker is not a constant
    // written somewhere downstream of the flag.
    assert.equal(parseDriverArgs([]).footprint, 'lean');
  } finally {
    sb.cleanup();
  }
});

// ---------------------------------------------------------------------------------------------
// `-h/--help` — the flag no cell passes to either side

test('--help names every flag the parser takes', () => {
  // `argvFor` builds every cell's argv out of the render flags, so `--help` is never passed and
  // the two CLIs were free to disagree about it — which they did, for the whole of P4: argparse
  // gave the reference the flag for free, and this hand-rolled parser fell through to
  // `unrecognized arguments: --help` and exit 2. A gate that only ever runs inputs both
  // implementations were built for cannot see a flag one of them does not have.
  const text = read('bin', 'build-driver.mjs');
  assert.deepEqual(objectKeys(text, 'const VALUED = {'), VALUED_FLAGS.map((f) => f[0]),
    'bin/build-driver.mjs\'s VALUED table and this file\'s frozen list disagree — the help text '
    + 'renders straight out of that table, so a flag missing from BOTH would otherwise be '
    + 'invisible to every gate in the repo');
  assert.deepEqual(objectKeys(text, 'const FLAGS = {'), BARE_FLAGS.map((f) => f[0]),
    'bin/build-driver.mjs\'s FLAGS table and this file\'s frozen list disagree');

  const said = help('--help').stdout;
  for (const [flag, dest, value, parsed = value] of VALUED_FLAGS) {
    // ACCEPTED, not merely listed: a help text naming a flag the parser refuses is the same drift
    // read from the other end, and it binds the dest this table names — which is the only way
    // `--target`'s aliasing to `out` gets stated at all.
    assert.deepStrictEqual(parseDriverArgs([flag, value])[dest], parsed,
      `${flag} does not bind ${dest} to the value given`);
    assert.deepStrictEqual(parseDriverArgs([`${flag}=${value}`])[dest], parsed,
      `${flag}=VALUE is not accepted; argparse takes both spellings`);
    assert.ok(said.includes(flag), `\`--help\` does not name ${flag}, which the parser accepts`);
  }
  for (const [flag, dest] of BARE_FLAGS) {
    assert.equal(parseDriverArgs([flag])[dest], true, `${flag} does not set ${dest}`);
    assert.ok(said.includes(flag), `\`--help\` does not name ${flag}, which the parser accepts`);
  }
  assert.ok(said.includes('-h, --help'), '`--help` does not name itself');
  // The other direction, which the containment above cannot give: an unknown flag is refused, so
  // "the parser accepted it" is a real result rather than the parser accepting everything.
  const r = runDriver(['--no-such-flag']);
  assert.equal(r.status, 2, `--no-such-flag was accepted: ${r.stdout.slice(0, 200)}`);
  assert.match(r.stderr, /unrecognized arguments: --no-such-flag/);
});

/** The quoted keys of a JS object literal opened by `decl`, in source order. */
function objectKeys(text, decl) {
  const at = text.indexOf(decl);
  assert.notEqual(at, -1, `bin/build-driver.mjs no longer contains ${JSON.stringify(decl)}`);
  const body = text.slice(at + decl.length, text.indexOf('};', at));
  return [...body.matchAll(/'(-{1,2}[a-z-]+)'\s*:/g)].map((m) => m[1]);
}

function help(flag) {
  const r = runDriver([flag]);
  assert.equal(r.status, 0,
    `\`geneseed-build ${flag}\` exited ${r.status}; help is not a refusal.\n`
    + `  stderr: ${r.stderr.slice(0, 400)}`);
  assert.equal(r.stderr, '', `help belongs on stdout: ${r.stderr.slice(0, 400)}`);
  return r;
}

test('both help spellings print the same text', () => {
  // `-h` is argparse's other half; a parser that handles only `--help` is half-ported.
  assert.equal(help('-h').stdout, help('--help').stdout);
});

test('the help choices come from the parser, not a copy', () => {
  // The four validated flags must show the SAME sets `choice` refuses against. A help text with
  // its own hardcoded list is the drift this catches: it goes stale the first time a theme dir
  // gains a posture, and every other gate stays green.
  const said = help('--help').stdout;
  let checked = 0;
  for (const flag of ['--emit', '--footprint', '--posture', '--mode']) {
    const r = runDriver([flag, `${flag}-no-such-value`]);
    assert.equal(r.status, 2, `${flag} accepted a nonsense value: ${r.stdout.slice(0, 200)}`);
    const refused = /choose from (.+)\)/.exec(r.stderr);
    assert.ok(refused, `no choice list in ${flag}'s refusal: ${r.stderr.slice(0, 300)}`);
    const values = [...refused[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.ok(values.length > 0, `${flag}'s refusal named no choices, so this row is vacuous`);
    for (const value of values) {
      assert.ok(said.includes(value), `${flag} accepts '${value}' but --help does not list it`);
    }
    checked += values.length;
  }
  assert.ok(checked >= 18, `only ${checked} choices were cross-checked against the help text`);
});
