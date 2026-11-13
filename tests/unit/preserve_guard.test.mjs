// The preserve guard (js/build/profile.mjs `preserveRefusal`): a build over an existing install of
// the same host that would change a setting it was NOT given refuses before writing anything.
// Reported 2026-11: an agent "reinstalled" with a bare build, and every setting of the user's harness
// fell back to the generator default. Written out, not recorded. Each cell states one rule:
//   1. a bare build over a non-default install exits 1, writes nothing, and lists every setting
//      that would change as `name: current -> new`, in the guard's order, then the preserving command
//   2. a flag the caller passes is intent: it is never listed, and the printed command carries it
//      in place of the install's own value; running that command passes and changes only that flag
//   3. `--reset` is the consent to the defaults: the build runs and the install takes them
//   4. no install at the target (an empty dir, or an OpenCode `.opencode/` Geneseed never wrote)
//      means no guard
//   5. the replays — an install's own profile argv, `rebuild-all`, `upgrade`'s `installAxes` tail —
//      compare equal and run unchanged; a composed whole selection that returns an axis to its
//      default needs `--reset`, which is why the console and the wizard pass it
//   6. a -global emit resolves its target through `--config-dir`, as the emit itself does
//   7. a replay argv spells every axis the config could default differently: posture and mode
//      elide only at `harness.config.json`'s own default, never at a frozen literal
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { main as driverMain } from '../../js/build/driver.mjs';
import * as generate from '../../js/build/generate.mjs';
import { installProfile, rebuildCommand, setupBuildArgs } from '../../js/build/profile.mjs';
import { installAxes } from '../../js/maintain/update.mjs';
import { copyCheckout } from '../helpers/cli_golden.mjs';
import { homeOverrides, makeSandbox, restoreProcessHome, sandboxProcessHome } from '../helpers/sandbox.mjs';

sandboxProcessHome();
const boxes = [];
after(() => {
  for (const b of boxes) b.cleanup();
  restoreProcessHome();
});
function sandbox(prefix) {
  const sb = makeSandbox(prefix);
  boxes.push(sb);
  return sb.path;
}

/** Run `fn` with stdout swallowed and stderr captured. */
function capture(fn) {
  const o = process.stdout.write; const e = process.stderr.write;
  let err = '';
  process.stdout.write = () => true;
  process.stderr.write = (s) => { err += String(s); return true; };
  try { return { value: fn(), err }; } finally { process.stdout.write = o; process.stderr.write = e; }
}

/** Every file under `dir` with its bytes, so "writes nothing" is a comparison of two maps. */
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p, 'latin1');
    }
  };
  walk(dir);
  return out;
}

// Every axis off its default, so a bare build differs on each of them.
const NON_DEFAULT = ['--theme', 'imperial', '--footprint', 'full', '--posture', 'artisan',
  '--mode', 'foreman', '--trust', 'prudent', '--doctrines', 'craft,rigor', '--exclude-rules', 'craft 3',
  '--exclude-skills', 'bruno', '--kits', 'spring-boot', '--shared-tier', 'on', '--no-deletion-gate',
  '--strict-consent'];

/** A Claude project install at a fresh repo, carrying `NON_DEFAULT`. */
function nonDefaultRepo() {
  const repo = sandbox('gs-guard-');
  const built = capture(() => driverMain(['--emit', 'claude', '--out', repo, ...NON_DEFAULT]));
  assert.equal(built.value, 0, `fixture: the install did not build\n${built.err}`);
  return repo;
}

/** The refusal's lines; the driver writes the platform's newline (`withPlatformNewlines`). */
const linesOf = (err) => err.split(/\r?\n/);

/** The refusal's change lines, in order. */
const changeLines = (err) => linesOf(err).filter((l) => /^ {2}[a-z-]+: /.test(l));

/** The install's own argv as `setupBuildArgs` spells it, with `mode` the caller's value. */
const ownArgv = (repo, mode = 'foreman') => ['--theme', 'imperial', '--emit', 'claude', '--out', repo,
  '--root', repo, '--footprint', 'full', '--posture', 'artisan', '--mode', mode, '--trust', 'prudent',
  '--doctrines', 'craft,rigor', '--exclude-rules', 'craft.3', '--exclude-skills', 'bruno',
  '--no-deletion-gate', '--strict-consent', '--kits', 'spring-boot', '--shared-tier', 'on'];

test('1. a bare build over a non-default install refuses, lists every change, and writes nothing', () => {
  const repo = nonDefaultRepo();
  const before = snapshot(repo);
  const r = capture(() => driverMain(['--emit', 'claude', '--out', repo]));
  assert.equal(r.value, 1, r.err);
  assert.deepEqual(snapshot(repo), before, 'a refused build wrote into the install');
  // The guard's order (`GUARDED`): theme, footprint, posture, mode, trust, the packs, the three
  // lists, the shared tier, then the gate switches in law order. Each side as the user spells it:
  // `none` for an empty list, on/off for a switch. A switch is named after its flag with the
  // leading `--no-` or `--` stripped, and reads as that flag says: `deletion-gate: off` is
  // `--no-deletion-gate` given, `strict-consent: on` is `--strict-consent` given.
  assert.deepEqual(changeLines(r.err), [
    '  theme: imperial -> neutral',
    '  footprint: full -> lean',
    '  posture: artisan -> peer',
    '  mode: foreman -> direct',
    '  trust: prudent -> balanced',
    '  doctrines: craft,rigor -> craft,rigor,ops,process,comms',
    '  exclude-rules: craft.3 -> none',
    '  exclude-skills: bruno -> none',
    '  kits: spring-boot -> none',
    '  shared-tier: on -> off',
    '  deletion-gate: off -> on',
    '  strict-consent: on -> off',
  ]);
  // The preserving command is the install's own rebuild — no flag was given, so nothing is swapped.
  assert.ok(linesOf(r.err).includes(`  ${rebuildCommand(ownArgv(repo))}`), r.err);
  assert.match(r.err, /^geneseed: error: refused: this build would change settings of the claude project install at /);
  assert.match(r.err, /Add --reset only to return the settings listed above to their defaults\./);
});

test('2. a flag the caller passes is intent: never listed, swapped into the command, and the command passes', () => {
  const repo = nonDefaultRepo();
  const r = capture(() => driverMain(['--emit', 'claude', '--out', repo, '--mode', 'direct', '--theme', 'imperial']));
  assert.equal(r.value, 1, r.err);
  const names = changeLines(r.err).map((l) => l.trim().split(':')[0]);
  assert.ok(!names.includes('mode') && !names.includes('theme'), `a passed flag was listed: ${names}`);
  assert.equal(names.length, 10, r.err);
  // `--mode direct` takes the place of the install's `--mode foreman`; the theme was equal anyway.
  const keep = ownArgv(repo, 'direct');
  assert.ok(linesOf(r.err).includes(`  ${rebuildCommand(keep)}`), r.err);
  // That command is exactly the change asked for: it runs, and only the mode moved.
  const ran = capture(() => driverMain(keep));
  assert.equal(ran.value, 0, ran.err);
  const p = installProfile('claude', 'project', repo);
  assert.deepEqual([p.theme, p.footprint, p.posture, p.mode, p.trust, p.doctrines, p.excludeRules,
    p.excludeSkills, p.kits, p.sharedTier, p.deletionGate],
  ['imperial', 'full', 'artisan', 'direct', 'prudent', ['craft', 'rigor'], ['craft.3'], ['bruno'],
    ['spring-boot'], true, false]);
});

test('2b. every differing setting passed explicitly runs, with no --reset', () => {
  const repo = nonDefaultRepo();
  const r = capture(() => driverMain(['--emit', 'claude', '--out', repo, '--theme', 'neutral',
    '--footprint', 'lean', '--posture', 'peer', '--mode', 'direct', '--trust', 'balanced',
    '--doctrines', 'craft,rigor,ops,process,comms', '--exclude-rules', 'none', '--exclude-skills', 'none',
    '--kits', 'none', '--shared-tier', 'off']));
  // The two switches have no flag for their default side, so they alone are still listed:
  // re-arming the deletion gate, or dropping strict consent, is a `--reset`.
  assert.equal(r.value, 1, r.err);
  assert.deepEqual(changeLines(r.err), ['  deletion-gate: off -> on', '  strict-consent: on -> off']);
});

test('3. --reset is the consent to the defaults: the build runs and the install takes them', () => {
  const repo = nonDefaultRepo();
  const r = capture(() => driverMain(['--emit', 'claude', '--out', repo, '--reset']));
  assert.equal(r.value, 0, r.err);
  const p = installProfile('claude', 'project', repo);
  assert.deepEqual([p.theme, p.footprint, p.mode, p.doctrines, p.kits, p.deletionGate],
    ['neutral', 'lean', 'direct', ['craft', 'rigor', 'ops', 'process', 'comms'], [], true]);
});

test('4. no install at the target means no guard: an empty dir, and an OpenCode dir Geneseed never wrote', () => {
  const fresh = sandbox('gs-guard-fresh-');
  assert.equal(capture(() => driverMain(['--emit', 'claude', '--out', fresh])).value, 0);
  const users = sandbox('gs-guard-oc-');
  fs.mkdirSync(path.join(users, '.opencode'));
  fs.writeFileSync(path.join(users, '.opencode', 'opencode.json'), '{}\n');
  const r = capture(() => driverMain(['--emit', 'opencode', '--out', users]));
  assert.equal(r.value, 0, r.err);
  // A plain bundle is never guarded, even over a bundle with other settings.
  const bundle = sandbox('gs-guard-files-');
  assert.equal(capture(() => driverMain(['--emit', 'files', '--out', bundle, '--mode', 'foreman'])).value, 0);
  assert.equal(capture(() => driverMain(['--emit', 'files', '--out', bundle])).value, 0);
});

test('4b. a dual-host repo guards its OpenCode install though the root marker names Claude', () => {
  // One `.geneseed-emit` per root, last deploy wins: after a Claude deploy it says `claude`, so the
  // marker alone cannot find the OpenCode install. Its `.opencode/.geneseed-manifest.json` can —
  // a file only Geneseed writes, unlike the `.opencode/` dir itself (cell 4).
  const repo = sandbox('gs-guard-dual-');
  assert.equal(capture(() => driverMain(['--emit', 'opencode', '--out', repo, '--mode', 'foreman'])).value, 0);
  assert.equal(capture(() => driverMain(['--emit', 'claude', '--out', repo])).value, 0);
  assert.equal(fs.readFileSync(path.join(repo, '.geneseed-emit'), 'utf8').trim(), 'claude');
  const r = capture(() => driverMain(['--emit', 'opencode', '--out', repo]));
  assert.equal(r.value, 1, r.err);
  assert.deepEqual(changeLines(r.err), ['  mode: foreman -> direct']);
  assert.ok(r.err.includes('opencode project install at '), r.err);
});

test('5. replays run unchanged: the profile argv, rebuild-all, and upgrade\'s installAxes tail', async () => {
  const repo = nonDefaultRepo();
  const before = installProfile('claude', 'project', repo);
  assert.equal(capture(() => driverMain(before.argv)).value, 0);
  assert.equal(capture(() => generate.rebuildAll()).value, 0);
  assert.deepEqual(installProfile('claude', 'project', repo), before, 'a replay moved a setting');
  // `upgrade` rebuilds an OpenCode global install from `--out/--theme/--emit` plus `installAxes`.
  const cfg = sandbox('gs-guard-ocg-');
  const saved = process.env.OPENCODE_CONFIG_DIR;
  process.env.OPENCODE_CONFIG_DIR = cfg;
  try {
    const built = capture(() => driverMain(['--emit', 'opencode-global', '--theme', 'imperial',
      '--footprint', 'full', '--mode', 'foreman', '--exclude-rules', 'process 5', '--no-done-gate']));
    assert.equal(built.value, 0, built.err);
    const axes = await installAxes(cfg, generate);
    const up = capture(() => driverMain(['--out', sandbox('gs-guard-bundle-'), '--theme', 'imperial',
      '--emit', 'opencode-global', ...axes]));
    assert.equal(up.value, 0, up.err);
  } finally {
    if (saved === undefined) delete process.env.OPENCODE_CONFIG_DIR;
    else process.env.OPENCODE_CONFIG_DIR = saved;
  }
});

test('5a. upgrade\'s installAxes tail replays an OpenCode project install with the shared tier on', async () => {
  // `upgrade` rebuilds a project install from `--out/--theme/--emit/--root` plus `installAxes(out)`.
  // The tail must carry `--shared-tier on`, or the replay reads as `shared-tier: on -> off`.
  const repo = sandbox('gs-guard-ocp-');
  const built = capture(() => driverMain(['--emit', 'opencode', '--out', repo, '--mode', 'foreman',
    '--shared-tier', 'on']));
  assert.equal(built.value, 0, built.err);
  const axes = await installAxes(repo, generate);
  assert.deepEqual(axes.slice(-2), ['--shared-tier', 'on']);
  const up = capture(() => driverMain(['--out', repo, '--theme', 'neutral', '--emit', 'opencode',
    '--root', repo, ...axes]));
  assert.equal(up.value, 0, up.err);
  assert.equal(installProfile('opencode', 'project', repo).sharedTier, true);
});

test('5b. a composed whole selection that returns an axis to its default needs --reset', () => {
  const repo = nonDefaultRepo();
  // As the console and the wizard compose it: every axis given, mode answered back to `direct`,
  // which `setupBuildArgs` elides. Without `--reset` that elision reads as an omission.
  const argv = setupBuildArgs('imperial', 'claude', repo, repo, 'full', 'artisan', 'direct',
    ['craft', 'rigor'], undefined, ['craft.3'], 'prudent', ['bruno'], { deletionGate: false, ownBranchPass: false },
    ['spring-boot'], true);
  const bare = capture(() => driverMain(argv));
  assert.equal(bare.value, 1);
  assert.deepEqual(changeLines(bare.err), ['  mode: foreman -> direct']);
  assert.equal(capture(() => driverMain([...argv, '--reset'])).value, 0);
  assert.equal(installProfile('claude', 'project', repo).mode, 'direct');
});

test('6. a -global emit is guarded at its --config-dir', () => {
  const cfg = sandbox('gs-guard-cg-');
  assert.equal(capture(() => driverMain(['--emit', 'claude-global', '--config-dir', cfg, '--mode', 'foreman'])).value, 0);
  const r = capture(() => driverMain(['--emit', 'claude-global', '--config-dir', cfg]));
  assert.equal(r.value, 1, r.err);
  assert.deepEqual(changeLines(r.err), ['  mode: foreman -> direct']);
  assert.ok(r.err.includes('claude global install at '), r.err);
  // The install's own argv names its dir (`--config-dir`), so the command rebuilds this one.
  assert.ok(linesOf(r.err).includes(`  ${rebuildCommand(['--theme', 'neutral', '--emit', 'claude-global',
    '--footprint', 'lean', '--mode', 'foreman', '--doctrines', 'craft,rigor,ops,process,comms',
    '--exclude-rules', 'none', '--config-dir', cfg])}`), r.err);
});

test('7. a replay over a config that moves posture, mode and excludeRules spells them and runs', () => {
  // The driver's default for an omitted axis is `configDefaults()`, which reads
  // `harness.config.json`. So a replay that elided `--posture peer` at the literal `peer` would,
  // under `{"posture":"artisan"}`, ask for artisan, and the guard would refuse the replay. In a
  // child on a COPY of the checkout: the config is read from the checkout the code runs from.
  const copy = sandbox('gs-guard-cfg-');
  copyCheckout(copy);
  fs.writeFileSync(path.join(copy, 'harness.config.json'),
    '{"theme": "neutral", "posture": "artisan", "mode": "foreman", "excludeRules": ["process.5"]}\n');
  const repo = sandbox('gs-guard-cfg-repo-');
  const home = sandbox('gs-guard-cfg-home-');
  const script = `
    import path from 'node:path';
    import { pathToFileURL } from 'node:url';
    const [root, repo] = process.argv.slice(1);
    const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);
    const { main } = await load('js/build/driver.mjs');
    const { installProfile } = await load('js/build/profile.mjs');
    const quiet = (fn) => { const w = process.stdout.write; process.stdout.write = () => true;
      try { return fn(); } finally { process.stdout.write = w; } };
    const built = quiet(() => main(['--emit', 'claude', '--out', repo, '--posture', 'peer',
      '--mode', 'direct', '--exclude-rules', 'none']));
    const p = installProfile('claude', 'project', repo);
    const replay = quiet(() => main(p.argv));
    const after = installProfile('claude', 'project', repo);
    console.log(JSON.stringify({ built, replay, argv: p.argv,
      kept: [after.posture, after.mode, after.excludeRules] }));
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, copy, repo],
    { encoding: 'utf8', windowsHide: true, env: { ...process.env, ...homeOverrides(home) } });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(got.built, 0, r.stderr);
  const at = (flag) => got.argv[got.argv.indexOf(flag) + 1];
  assert.equal(at('--posture'), 'peer', got.argv.join(' '));
  assert.equal(at('--mode'), 'direct', got.argv.join(' '));
  assert.equal(at('--exclude-rules'), 'none', got.argv.join(' '));
  assert.equal(got.replay, 0, r.stderr);
  assert.deepEqual(got.kept, ['peer', 'direct', []]);
});
