// `tests/test_update.py` — `UpgradeFlowTests`, the orchestration `upgrade()` performs over its
// four collaborators.
//
// THE REFERENCE MOCKS ALL FOUR. `_preflight`, `_measure_upstream`, `_pull_and_validate` and
// `_rebuild_bundle` are each replaced with a stand-in returning a hand-written tuple, and the
// assertions are on the returned exit code plus `rb.assert_not_called()`. That is the only shape
// available to it: `_rebuild_bundle` really rebuilds, and a unit test cannot afford to.
//
// HERE NOTHING IS MOCKED AND THE CALL COUNT BECOMES AN OBSERVATION. The module-path injection
// (`tests/unit/update_git.test.mjs`'s header explains it) gives this file a private checkout with
// a real bare origin, so every arm is a state a user can actually be in — and `_rebuild_bundle`
// not being called stops being a mock's ledger entry and becomes THE BUNDLE DIRECTORY IS STILL
// EMPTY. That is the property the reference's assertion was standing in for: a precondition
// failure must not leave a half-written harness behind.
//
// ⚠ THE ORDER OF THE TESTS IS LOAD-BEARING, and node:test runs them in declaration order. The
// `ready` arm consumes the pending upstream commit, which is what makes the `uptodate` arm after
// it up to date; the doctor arm pushes a tip that fails validation and must therefore come last.
// Each says so at its own site.
//
// ⚠ `GENESEED_WEB_JOB` IS SET FOR THE WHOLE FILE, and not for convenience. `rebuildBundle` ends
// by calling `restartDaemon(theme, 4747, …)` — the DEVELOPER'S daemon, on the developer's real
// port, since nothing about a redirected home moves a TCP port. The marker is the product's own
// documented way of saying "this rebuild is itself a web job, do not bounce the server", and the
// recorded cell `upgrade/the-web-job-marker-…` gates what the marker does. Without it, running
// this file restarts whatever `geneseed web` the machine happens to have up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp, { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';

import { makeSandbox, sandboxProcessHome, restoreProcessHome } from '../helpers/sandbox.mjs';
import { copyCheckout } from '../helpers/cli_golden.mjs';

sandboxProcessHome();

const SAVED = {
  protocol: process.env.GIT_ALLOW_PROTOCOL,
  webJob: process.env.GENESEED_WEB_JOB,
  out: process.env.GENESEED_OUT,
};
process.env.GIT_ALLOW_PROTOCOL = 'file';
process.env.GENESEED_WEB_JOB = '1';

const sb = makeSandbox('gs-updf-');
const CO = path.join(sb.path, 'checkout');
const ORIGIN = path.join(sb.path, 'origin.git');
const OTHER = path.join(sb.path, 'other');

/** Loud on failure — a silent `git init` would make every arm below a statement about nothing. */
function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0,
    `fixture: git ${args.join(' ')} in ${cwd} -> ${r.status}\n${r.stderr || ''}`);
  return (r.stdout || '').trim();
}

copyCheckout(CO, {});
git(sb.path, 'init', '--bare', '-b', 'main', ORIGIN);
git(CO, 'init', '-b', 'main');
git(CO, 'config', 'user.email', 'fixture@geneseed.test');
git(CO, 'config', 'user.name', 'fixture');
git(CO, 'add', '-A');
git(CO, 'commit', '-qm', 'the copied checkout');
git(CO, 'remote', 'add', 'origin', ORIGIN);
git(CO, 'push', '-q', '-u', 'origin', 'main');
git(sb.path, 'clone', '-q', ORIGIN, OTHER);
git(OTHER, 'config', 'user.email', 'fixture@geneseed.test');
git(OTHER, 'config', 'user.name', 'fixture');

const U = await import(pathToFileURL(path.join(CO, 'js', 'maintain', 'update.mjs')).href);

/**
 * A bundle target nothing has written to yet, per arm.
 *
 * `upgrade()` reads `GENESEED_OUT` at call time, so this is the whole injection: the same
 * function either fills this directory or leaves it exactly as found, and which of the two it
 * did is the assertion the reference could only make against a mock's call count.
 */
function freshOut(name) {
  const dir = path.join(sb.path, `out-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  process.env.GENESEED_OUT = dir;
  return dir;
}

const isEmpty = (dir) => fs.readdirSync(dir).length === 0;

test.after(() => {
  for (const [key, saved] of [['GIT_ALLOW_PROTOCOL', SAVED.protocol],
    ['GENESEED_WEB_JOB', SAVED.webJob], ['GENESEED_OUT', SAVED.out]]) {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
  restoreProcessHome();
  sb.cleanup();
});

test('the fixture is a real checkout with a real upstream, and it is not this one', () => {
  assert.notEqual(path.resolve(CO), path.resolve(process.cwd()));
  assert.equal(git(CO, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'), 'origin/main');
  assert.ok(fs.existsSync(path.join(CO, 'bin', 'build-driver.mjs')),
    'the copy has no generator entry point, so no arm below could rebuild anything');
});

test('a failed precondition returns 3 and writes no bundle at all', async () => {
  // `test_precondition_info_returns_3_no_rebuild`.
  //
  // WHICH precondition is asserted through git rather than through the return code, because
  // every arm of `PRE_MSG` is kind `info` and therefore exits 3: a copy that had stopped being a
  // git checkout, or lost its upstream, would produce the same 3 from a different branch of the
  // same function and this arm would be about nothing.
  const out = freshOut('dirty');
  const f = path.join(CO, 'README.md');
  const before = fs.readFileSync(f);
  fs.writeFileSync(f, 'a local edit\n');
  try {
    assert.notEqual(git(CO, 'status', '--porcelain', '--untracked-files=no'), '',
      'the fixture is not actually dirty, so this arm is testing the wrong precondition');
    const rc = await U.upgrade(null);
    assert.equal(rc, 3, 'a dirty checkout must be an info exit, not an error');
    assert.ok(isEmpty(out),
      `the precondition failed and the bundle was rebuilt anyway: ${fs.readdirSync(out)}`);
  } finally { fs.writeFileSync(f, before); }
  assert.equal(git(CO, 'status', '--porcelain', '--untracked-files=no'), '',
    'the fixture did not restore itself, so every arm after this one is dirty too');
});

test('a checkout behind its origin pulls, then rebuilds, and returns 0', async () => {
  // `test_ready_pulls_then_rebuilds`, with both halves observed rather than counted: HEAD really
  // moves and the bundle really appears. ⚠ THIS ARM CONSUMES THE PENDING COMMIT — the `uptodate`
  // test below depends on it having run first. ⚠ THE ONE REAL `doctor --all` THROUGH THE WHOLE
  // `upgrade()`, beside `update_git.test.mjs`'s clean fast-forward through `pullAndValidate`: the
  // log line asserted below shows a real doctor answered the gate. Keep this arm real.
  fs.writeFileSync(path.join(OTHER, 'an-upstream-change.txt'), 'from upstream\n');
  git(OTHER, 'add', '-A');
  git(OTHER, 'commit', '-qm', 'something to pull');
  git(OTHER, 'push', '-q');
  const out = freshOut('ready');
  const before = git(CO, 'rev-parse', 'HEAD');

  const rc = await U.upgrade(null);
  assert.equal(rc, 0, 'a clean fast-forward onto a valid tree did not succeed');
  assert.notEqual(git(CO, 'rev-parse', 'HEAD'), before, 'the pull never happened');
  assert.ok(fs.existsSync(path.join(CO, 'an-upstream-change.txt')), 'the pulled file never arrived');
  assert.ok(!isEmpty(out), 'the upgrade succeeded without rebuilding the bundle');
  const themes = fs.readdirSync(path.join(CO, 'themes'))
    .filter((f) => f.endsWith('.json') && !f.startsWith('_')).length;
  assert.ok(fs.readFileSync(U.logfile(), 'utf8').includes(`[doctor] ok — ${themes} theme(s) clean`),
    'the gate did not run a real doctor over every theme');
});

test('an up-to-date checkout still rebuilds, and still returns 0', async () => {
  // `test_up_to_date_still_rebuilds_returns_0` — the arm most easily lost to an "optimisation".
  // Nothing to pull is NOT nothing to do: the bundle is rendered from source that may have been
  // edited locally, and an upgrade that skipped the render would report success over a stale
  // harness. Depends on the arm above having consumed the pending commit.
  const out = freshOut('uptodate');
  assert.equal(git(CO, 'rev-parse', 'HEAD'), git(CO, 'rev-parse', 'origin/main'),
    'the fixture is not up to date, so this arm is testing the wrong branch');

  const rc = await U.upgrade(null);
  assert.equal(rc, 0);
  assert.ok(!isEmpty(out), 'an up-to-date upgrade skipped the rebuild');
});

test('an upgrade re-emits an opencode-global install on its OWN footprint and excluded rules', async () => {
  // The bundle rebuild used to pass only --out/--theme/--emit, so the generator's defaults won:
  // footprint `lean`, and packs/rules from `harness.config.json`. The install was rewritten as the
  // default, markers and all, and `rebuild-all` right after read those rewritten markers back —
  // so a `full`, rule-excluded install came out of every upgrade lean with the rule switched on.
  const cfg = path.join(sb.path, 'opencode-cfg');
  const saved = process.env.OPENCODE_CONFIG_DIR;
  process.env.OPENCODE_CONFIG_DIR = cfg;
  try {
    const built = spawnSync(process.execPath, [path.join(CO, 'bin', 'build-driver.mjs'),
      '--emit', 'opencode-global', '--footprint', 'full', '--exclude-rules', 'process 5'],
    { cwd: CO, encoding: 'utf8', windowsHide: true });
    assert.equal(built.status, 0, `fixture: the install did not build\n${built.stderr}`);
    const footprint = () => fs.readFileSync(path.join(cfg, '.geneseed-footprint'), 'utf8').trim();
    const carrier = () => fs.readFileSync(path.join(cfg, 'AGENT.md'), 'utf8');
    assert.equal(footprint(), 'full');
    assert.match(carrier(), /^Excluded rules: process 5$/m,
      'fixture: the install carries no excluded rule, so this arm is about nothing');
    freshOut('axes');

    const rc = await U.upgrade(null);
    assert.equal(rc, 0);
    assert.equal(footprint(), 'full', 'the upgrade reset a full install to the default footprint');
    assert.match(carrier(), /^Excluded rules: process 5$/m,
      'the upgrade switched back on a rule the install had excluded');
  } finally {
    if (saved === undefined) delete process.env.OPENCODE_CONFIG_DIR;
    else process.env.OPENCODE_CONFIG_DIR = saved;
  }
});

// A SCRIPTED DOCTOR for the unfinished-gate arms. It counts its runs, hangs while `HANG` exists,
// and otherwise exits with the code in `VERDICT`, so one pulled tip can say all three things.
const HANG = path.join(sb.path, 'doctor-hangs');
const VERDICT = path.join(sb.path, 'doctor-verdict');
const CALLS = path.join(sb.path, 'doctor-calls');
const doctorRuns = () => (fs.existsSync(CALLS) ? fs.readFileSync(CALLS, 'utf8').length : 0);
function pushed(name) {
  fs.writeFileSync(path.join(OTHER, name), 'from upstream\n');
  git(OTHER, 'add', '-A');
  git(OTHER, 'commit', '-qm', name);
  git(OTHER, 'push', '-q');
  git(CO, 'fetch', '-q');
}
/** Pull the pending tip under a doctor that never answers. */
function pullUnfinished() {
  fs.writeFileSync(HANG, '');
  const [ok, code] = U.pullAndValidate(() => {}, 1500);
  fs.unlinkSync(HANG);
  assert.equal(ok, false);
  assert.equal(code, 'doctor_unfinished');
}

test('after an unfinished gate the next update runs the gate, and only then rebuilds', async () => {
  // An unfinished gate is not a pass. With nothing left to pull, the next update used to go
  // straight to the rebuild, so a tree no doctor had judged reached every install.
  fs.writeFileSync(path.join(OTHER, 'bin', 'geneseed-cli.mjs'), [
    "import { appendFileSync, existsSync, readFileSync } from 'node:fs';",
    "if (process.argv[2] !== 'doctor') process.exit(0);",
    `appendFileSync(${JSON.stringify(CALLS)}, 'x');`,
    `if (existsSync(${JSON.stringify(HANG)})) setTimeout(() => {}, 120000);`,
    `else process.exit(Number(readFileSync(${JSON.stringify(VERDICT)}, 'utf8')));`,
    '',
  ].join('\n'));
  fs.writeFileSync(VERDICT, '0');
  pushed('scripted-doctor.txt');
  pullUnfinished();

  const out = freshOut('regate-pass');
  const runs = doctorRuns();
  assert.equal(await U.upgrade(null), 0);
  assert.equal(doctorRuns(), runs + 1, 'the update rebuilt with no verdict on the pulled source');
  assert.ok(!isEmpty(out), 'a passed gate did not rebuild');

  freshOut('regate-done');
  assert.equal(await U.upgrade(null), 0);
  assert.equal(doctorRuns(), runs + 1, 'a verdict given once was asked for again');
});

test('a gate that stays unfinished still holds the rebuild back', () => {
  const verified = git(CO, 'rev-parse', 'HEAD');
  pushed('still-unfinished.txt');
  pullUnfinished();
  const pending = U.pendingGate();
  assert.equal(pending.verified, verified, 'the commit the last verdict covers was not kept');
  fs.writeFileSync(HANG, '');
  const [ok, code] = U.gatePulled(pending.verified, () => {}, 1500);
  fs.unlinkSync(HANG);
  assert.equal(ok, false);
  assert.equal(code, 'doctor_unfinished');
  assert.equal(U.pendingGate().verified, verified, 'a second unfinished gate forgot the first');
});

test('a failed verdict after an unfinished gate rolls back to the last verified commit', async () => {
  // Rides on the arm above: HEAD is unchecked, and the verified commit is one behind it.
  const verified = U.pendingGate()?.verified;
  assert.ok(verified, 'fixture: no gate is pending');
  fs.writeFileSync(VERDICT, '1');
  const out = freshOut('regate-fail');
  assert.equal(await U.upgrade(null), 1);
  assert.equal(git(CO, 'rev-parse', 'HEAD'), verified, 'the rollback missed the verified commit');
  assert.ok(isEmpty(out), `a failed gate rebuilt: ${fs.readdirSync(out)}`);
});

test('a new pull over an unfinished gate rolls back past both unchecked commits', async () => {
  fs.writeFileSync(VERDICT, '0');
  const verified = git(CO, 'rev-parse', 'HEAD');
  pullUnfinished();
  pushed('over-the-unfinished.txt');
  fs.writeFileSync(VERDICT, '1');
  freshOut('regate-pull');
  assert.equal(await U.upgrade(null), 1);
  assert.equal(git(CO, 'rev-parse', 'HEAD'), verified, 'the rollback stopped on an unchecked commit');
});

/** The record of an unfinished gate on this branch, as git spells its path. */
const recordFile = (branch = 'main') => path.resolve(CO,
  git(CO, 'rev-parse', '--git-path', `geneseed-doctor-pending-${branch}`));

/** Back to a checked tip, so the next arm starts with no record and nothing to pull. */
async function settled() {
  fs.writeFileSync(VERDICT, '0');
  freshOut('settled');
  assert.equal(await U.upgrade(null), 0, 'fixture: the tree did not settle');
  assert.equal(U.pendingGate(), null, 'fixture: a record survived a pass');
}

/** Every doctor spawn answers as a timeout does, so an update needs no 300 s wait. */
async function withDoctorTimingOut(fn) {
  const real = cp.spawnSync;
  cp.spawnSync = (exe, args, opts) => (args?.includes('doctor')
    ? { error: new Error('spawnSync ETIMEDOUT'), status: null, stdout: '', stderr: '' }
    : real(exe, args, opts));
  syncBuiltinESMExports();
  try { return await fn(); } finally {
    cp.spawnSync = real;
    syncBuiltinESMExports();
  }
}

test('a record nobody can read refuses the rebuild and is kept', async () => {
  // An unreadable record is not the user moving on. Only git saying "not an ancestor" or HEAD
  // back on the commit is. Anything else may be an unchecked tree, so the rebuild waits.
  await settled();
  for (const text of ['', 'not-a-commit\n']) {
    fs.writeFileSync(recordFile(), text);
    const out = freshOut('record-bad');
    assert.equal(await U.upgrade(null), 1, `a record of ${JSON.stringify(text)} passed`);
    assert.ok(isEmpty(out), `a bad record rebuilt: ${fs.readdirSync(out)}`);
    assert.ok(fs.existsSync(recordFile()), 'the record was dropped on a failure to read it');
  }
  fs.unlinkSync(recordFile());
});

test('a git that cannot answer is not an empty record', () => {
  const saved = process.env.PATH;
  process.env.PATH = '';
  let pending;
  try { pending = U.pendingGate(); } finally { process.env.PATH = saved; }
  assert.ok(pending?.blocked, 'no answer from git read as nothing pending');
});

test('a pull that cannot be recorded does not happen', () => {
  // The record goes down BEFORE the merge, so a killed update also leaves one. If it cannot be
  // written, nothing could hold the rebuild back later, so nothing moves.
  pushed('unrecordable.txt');
  const head = git(CO, 'rev-parse', 'HEAD');
  const runs = doctorRuns();
  const real = fs.writeFileSync;
  fs.writeFileSync = (p, ...rest) => {
    if (String(p).includes('geneseed-doctor-pending')) {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    }
    return real(p, ...rest);
  };
  syncBuiltinESMExports();
  let result;
  try { result = U.pullAndValidate(() => {}); } finally {
    fs.writeFileSync = real;
    syncBuiltinESMExports();
  }
  assert.deepEqual(result.slice(0, 2), [false, 'gate_unrecorded']);
  assert.equal(git(CO, 'rev-parse', 'HEAD'), head, 'the pull went ahead with no record');
  assert.equal(doctorRuns(), runs);
});

test('bootstrap does not hand off to setup over an unchecked source', async () => {
  // Rides on the commit the arm above left pending. Setup renders, and this tree has no verdict.
  freshOut('bootstrap-unchecked');
  let handedOff = false;
  const rc = await withDoctorTimingOut(() => U.cmdBootstrap({ noSetup: false },
    { handoff: () => { handedOff = true; return 0; } }));
  assert.equal(handedOff, false, 'setup rendered a source no doctor had judged');
  assert.equal(rc, 1);
  await settled();
});

test('a rollback never rewinds a branch the record is not about', async () => {
  pushed('side-branch.txt');
  const verified = git(CO, 'rev-parse', 'HEAD');
  pullUnfinished();
  const tip = git(CO, 'rev-parse', 'HEAD');
  git(CO, 'checkout', '-q', '-b', 'side', '--track', 'origin/main');
  try {
    fs.writeFileSync(VERDICT, '1');
    freshOut('side');
    await U.upgrade(null);
    assert.equal(git(CO, 'rev-parse', 'HEAD'), tip, 'the rollback rewound another branch');
  } finally {
    git(CO, 'checkout', '-q', 'main');
    git(CO, 'branch', '-qD', 'side');
  }
  assert.equal(U.pendingGate()?.verified, verified, 'the record of main was lost on the side branch');
  await settled();
});

test('a pulled source that fails the doctor returns 1 and leaves no bundle', async () => {
  // `test_doctor_fail_returns_1_no_rebuild`. The pulled tip's doctor is a STAND-IN that exits 1
  // at once: what this arm owns is the orchestration — the exit code, and no bundle written from
  // a rolled-back tree — and that holds for any doctor that says no. Whether the real doctor
  // rejects a real fault, and the rollback lands on the exact sha with the tree restored, is
  // `update_git.test.mjs`'s "rolled back to the exact previous commit". A real sweep here cost a
  // whole `doctor --all` (and a second one in the bootstrap arm below) to re-prove it.
  // ⚠ LAST, because it leaves the failing tip on the origin.
  fs.writeFileSync(path.join(OTHER, 'bin', 'geneseed-cli.mjs'), 'process.exit(1);\n');
  git(OTHER, 'add', '-A');
  git(OTHER, 'commit', '-qm', 'a doctor that always fails');
  git(OTHER, 'push', '-q');

  const out = freshOut('doctorfail');
  const before = git(CO, 'rev-parse', 'HEAD');

  const rc = await U.upgrade(null);
  assert.equal(rc, 1, 'a source tree that fails validation must be an error exit, not info');
  assert.equal(git(CO, 'rev-parse', 'HEAD'), before,
    'the rollback did not land back on the previous commit');
  assert.ok(isEmpty(out),
    `the bundle was rebuilt from a source tree that had just been rolled back: ${fs.readdirSync(out)}`);
});

test('bootstrap exits 1 over a failed update even when the setup it hands off to succeeds', async () => {
  // Rides on the failing tip the doctor arm above left upstream, so the update step fails again.
  // `setup` still runs — the user asked for it — but its exit code used to become bootstrap's,
  // so a script saw 0 over an update that never happened. The real `setup` exits 1 off a
  // terminal, which would hide that, so the handoff is a stand-in that succeeds.
  freshOut('bootstrap');
  let handedOff = false;
  const rc = await U.cmdBootstrap({ noSetup: false },
    { handoff: () => { handedOff = true; return 0; } });
  assert.ok(handedOff, 'a failed update skipped the setup handoff the user asked for');
  assert.equal(rc, 1, "a failed update was reported through setup's exit code");
});
