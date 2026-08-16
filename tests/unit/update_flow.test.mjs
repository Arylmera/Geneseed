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
import { spawnSync } from 'node:child_process';
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

const U = await import(pathToFileURL(path.join(CO, 'js', 'update.mjs')).href);

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
  assert.ok(fs.existsSync(path.join(CO, 'bin', 'geneseed.mjs')),
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
    const rc = await U.upgrade(null, null);
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
  // test below depends on it having run first.
  fs.writeFileSync(path.join(OTHER, 'an-upstream-change.txt'), 'from upstream\n');
  git(OTHER, 'add', '-A');
  git(OTHER, 'commit', '-qm', 'something to pull');
  git(OTHER, 'push', '-q');
  const out = freshOut('ready');
  const before = git(CO, 'rev-parse', 'HEAD');

  const rc = await U.upgrade(null, null);
  assert.equal(rc, 0, 'a clean fast-forward onto a valid tree did not succeed');
  assert.notEqual(git(CO, 'rev-parse', 'HEAD'), before, 'the pull never happened');
  assert.ok(fs.existsSync(path.join(CO, 'an-upstream-change.txt')), 'the pulled file never arrived');
  assert.ok(!isEmpty(out), 'the upgrade succeeded without rebuilding the bundle');
});

test('an up-to-date checkout still rebuilds, and still returns 0', async () => {
  // `test_up_to_date_still_rebuilds_returns_0` — the arm most easily lost to an "optimisation".
  // Nothing to pull is NOT nothing to do: the bundle is rendered from source that may have been
  // edited locally, and an upgrade that skipped the render would report success over a stale
  // harness. Depends on the arm above having consumed the pending commit.
  const out = freshOut('uptodate');
  assert.equal(git(CO, 'rev-parse', 'HEAD'), git(CO, 'rev-parse', 'origin/main'),
    'the fixture is not up to date, so this arm is testing the wrong branch');

  const rc = await U.upgrade(null, null);
  assert.equal(rc, 0);
  assert.ok(!isEmpty(out), 'an up-to-date upgrade skipped the rebuild');
});

test('a pulled source that fails the doctor returns 1 and leaves no bundle', async () => {
  // `test_doctor_fail_returns_1_no_rebuild`, and the fault is a real one the doctor really
  // rejects — a theme missing a template key, which is the theme-parity gate — rather than a
  // mocked `(False, "doctor_fail", …)`. ⚠ LAST, because it leaves a broken tip on the origin.
  const themePath = path.join(OTHER, 'themes', 'neutral.json');
  const theme = JSON.parse(fs.readFileSync(themePath, 'utf8'));
  assert.ok('VOICE' in theme, 'neutral.json no longer has a VOICE key — this fixture is stale');
  delete theme.VOICE;
  fs.writeFileSync(themePath, `${JSON.stringify(theme, null, 2)}\n`);
  git(OTHER, 'add', '-A');
  git(OTHER, 'commit', '-qm', 'break theme parity');
  git(OTHER, 'push', '-q');

  const out = freshOut('doctorfail');
  const before = git(CO, 'rev-parse', 'HEAD');

  const rc = await U.upgrade(null, null);
  assert.equal(rc, 1, 'a source tree that fails validation must be an error exit, not info');
  assert.equal(git(CO, 'rev-parse', 'HEAD'), before,
    'the rollback did not land back on the previous commit');
  assert.ok(isEmpty(out),
    `the bundle was rebuilt from a source tree that had just been rolled back: ${fs.readdirSync(out)}`);
});
