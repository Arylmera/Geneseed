// `tests/test_update.py` — the half that needs a git repository: `PreflightTests`,
// `OriginDisplayTests`, `MeasureUpstreamTests`.
//
// HOW THE SEAM CROSSED, because it is the whole design of this file. The reference reaches every
// one of these through `mock.patch.object(_update, "_git", side_effect=seam)`, handing the parser
// a tuple it wrote itself. ESM cannot rebind an imported binding, and `gitRun` has no seam: it
// runs `git -C ROOT`, where `ROOT` is derived from `js/update.mjs`'s own location.
//
// So the injection point is the MODULE PATH. `copyCheckout` builds a private checkout, `git init`
// makes it a real repository with a real bare origin, and importing `js/update.mjs` OUT OF THE
// COPY gives it that copy's `ROOT`. ESM caches per URL, so one copy is one module instance and
// one import serves the whole file — measured at 1.7 s for the copy and 72 ms for the import.
//
// That is not a workaround for a missing mock, it is a better fixture. Every answer below is
// produced by real git against a real repository, so `Preflight`'s six states are six states a
// user can actually be in rather than six hand-written return tuples, and `measureUpstream` runs
// a REAL `git fetch` over `file://`. A mocked seam cannot fail when git changes its output; this
// can, which is the point.
//
// THE FETCH IS REAL AND STILL CANNOT REACH THE NETWORK. `setUpModule` sets
// `GIT_ALLOW_PROTOCOL=file`, so an https fetch dies with `transport 'https' not allowed` before a
// socket opens. The reference calls that its positive control; here it is load-bearing, because
// unlike the reference this file does not mock the fetch away.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { makeSandbox, sandboxProcessHome, restoreProcessHome } from '../helpers/sandbox.mjs';
import { copyCheckout } from '../helpers/cli_golden.mjs';

sandboxProcessHome();

// `setUpModule`'s git ban, and it is enforced rather than declared — see the header.
const SAVED_PROTOCOL = process.env.GIT_ALLOW_PROTOCOL;
process.env.GIT_ALLOW_PROTOCOL = 'file';

const sb = makeSandbox('gs-updg-');
const CO = path.join(sb.path, 'checkout');
const ORIGIN = path.join(sb.path, 'origin.git');
const OTHER = path.join(sb.path, 'other');

/** Every fixture call: loud on failure, because a silent `git init` makes the whole file vacuous. */
function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0,
    `fixture: git ${args.join(' ')} in ${cwd} -> ${r.status}\n${r.stderr || ''}`);
  return (r.stdout || '').trim();
}

const commit = (cwd, name) => {
  fs.writeFileSync(path.join(cwd, name), name);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', name);
};

copyCheckout(CO, {});
git(sb.path, 'init', '--bare', '-b', 'main', ORIGIN);
git(CO, 'init', '-b', 'main');
git(CO, 'config', 'user.email', 'fixture@geneseed.test');
git(CO, 'config', 'user.name', 'fixture');
git(CO, 'add', '-A');
git(CO, 'commit', '-qm', 'the copied checkout');
git(CO, 'remote', 'add', 'origin', ORIGIN);
git(CO, 'push', '-q', '-u', 'origin', 'main');

// The upstream, as a second working copy that can push commits the checkout has not seen.
git(sb.path, 'clone', '-q', ORIGIN, OTHER);
git(OTHER, 'config', 'user.email', 'fixture@geneseed.test');
git(OTHER, 'config', 'user.name', 'fixture');

const U = await import(pathToFileURL(path.join(CO, 'js', 'update.mjs')).href);

test.after(() => {
  if (SAVED_PROTOCOL === undefined) delete process.env.GIT_ALLOW_PROTOCOL;
  else process.env.GIT_ALLOW_PROTOCOL = SAVED_PROTOCOL;
  restoreProcessHome();
  sb.cleanup();
});

// The fixture's own precondition. Without it every "the copy answered X" assertion below could
// equally be the DEVELOPER's checkout answering, which is `ready` on a clean tree too.
test('the fixture repository is the one under test, not the developer checkout', () => {
  assert.notEqual(path.resolve(CO), path.resolve(process.cwd()));
  assert.equal(git(CO, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.equal(git(CO, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'), 'origin/main');
  assert.ok(fs.existsSync(path.join(CO, 'js', 'update.mjs')));
});

// ---------------------------------------------------------------------------------------------
// `PreflightTests` — Phase A, local only, never raises.
//
// Each state is established for real and undone in a `finally`, so the order of the tests is not
// load-bearing here (it is in `MeasureUpstream` below, which says so).

test('preflight is ready on a clean checkout with an upstream', () => {
  const p = U.preflight();
  assert.equal(p.code, 'ready');
  assert.equal(p.ok, true);
});

test('preflight reports a dirty tracked change', () => {
  // A TRACKED file, because the porcelain call passes `--untracked-files=no`: a stray build
  // artefact must not block an update, and only a real local edit may.
  const f = path.join(CO, 'README.md');
  const before = fs.readFileSync(f);
  fs.writeFileSync(f, 'local edit\n');
  try {
    const p = U.preflight();
    assert.equal(p.code, 'dirty');
    assert.equal(p.ok, false);
  } finally { fs.writeFileSync(f, before); }
  assert.equal(U.preflight().code, 'ready', 'the fixture did not restore itself');
});

test('preflight reports an untracked file as READY, not dirty', () => {
  // Not in the reference, and the counterpart that gives the test above its meaning: the two
  // differ only by `--untracked-files=no`, so without this a preflight that ignored the flag
  // and called everything dirty would still pass every assertion in the class.
  const f = path.join(CO, 'a-stray-artefact.tmp');
  fs.writeFileSync(f, 'x');
  try { assert.equal(U.preflight().code, 'ready'); } finally { fs.unlinkSync(f); }
});

test('preflight reports a missing upstream', () => {
  git(CO, 'branch', '--unset-upstream');
  try { assert.equal(U.preflight().code, 'no_upstream'); } finally {
    git(CO, 'branch', '--set-upstream-to=origin/main', 'main');
  }
});

test('preflight reports a detached HEAD', () => {
  git(CO, 'checkout', '-q', '--detach');
  try { assert.equal(U.preflight().code, 'detached'); } finally { git(CO, 'checkout', '-q', 'main'); }
});

test('preflight reports a directory that is not a git checkout', () => {
  // The npm-installed case, which is now the commonest way to reach this arm.
  const dotgit = path.join(CO, '.git');
  const stashed = path.join(sb.path, 'dotgit-stashed');
  fs.renameSync(dotgit, stashed);
  try { assert.equal(U.preflight().code, 'not_git'); } finally { fs.renameSync(stashed, dotgit); }
  assert.equal(U.preflight().code, 'ready');
});

test('preflight reports git missing from PATH', () => {
  // `pyWhich` reads PATH at CALL time, so this needs no child — and emptying PATH is the honest
  // stand-in for the reference's `rc=None` seam: it is the same question asked of the real
  // lookup rather than of a tuple.
  const saved = process.env.PATH;
  process.env.PATH = '';
  try {
    const p = U.preflight();
    assert.equal(p.code, 'no_git_exe');
    assert.equal(p.kind, 'info', 'a missing git must not be reported as an error');
  } finally { process.env.PATH = saved; }
});

// ---------------------------------------------------------------------------------------------
// `OriginDisplayTests` — the wiring in front of `parseOrigin`, whose own eight cases are in
// `update.test.mjs`.

test('a local-path origin falls back to the default', () => {
  // NOT a contrivance: the fixture's remote is a Windows path, and `js/update.mjs`'s
  // `urlsplitHostPath` docblock predicts exactly this — `urlsplit` answers with a scheme of `c`
  // and no host, which is the fallback every local checkout takes.
  assert.deepEqual(U.originDisplay(), U.DEFAULT_ORIGIN);
});

test('a github remote is read into a slug', () => {
  git(CO, 'remote', 'set-url', 'origin', 'https://github.com/Own/Repo.git');
  try {
    assert.equal(U.originDisplay().githubSlug, 'Own/Repo');
    assert.equal(U.originDisplay().url, 'https://github.com/Own/Repo');
  } finally { git(CO, 'remote', 'set-url', 'origin', ORIGIN); }
});

// ---------------------------------------------------------------------------------------------
// `MeasureUpstreamTests` — Phase B: fetch, then classify.
//
// ⚠ THESE FIVE ARE ORDERED AND CUMULATIVE, unlike everything above. Each builds the repository
// state the next one starts from — up to date, then behind, then diverged, then unrelated —
// because that is the sequence a real checkout moves through and rebuilding it per test would
// cost a clone each time. The fetch is real on every one of them.

test('measureUpstream says up to date when nothing has moved', async () => {
  const [code, behind, err] = await U.measureUpstream();
  assert.equal(code, 'uptodate');
  assert.equal(behind, 0);
  assert.equal(err, '');
});

test('measureUpstream counts how far behind, and calls it ready', async () => {
  commit(OTHER, 'upstream-1.txt');
  commit(OTHER, 'upstream-2.txt');
  commit(OTHER, 'upstream-3.txt');
  git(OTHER, 'push', '-q');
  const [code, behind] = await U.measureUpstream();
  assert.equal(code, 'ready');
  assert.equal(behind, 3, 'the count is what the user is told, so an off-by-one is user-visible');
});

test('measureUpstream reports diverged when both sides moved from a common base', async () => {
  commit(CO, 'local-only.txt');
  const [code] = await U.measureUpstream();
  assert.equal(code, 'diverged');
});

test('measureUpstream reports unrelated when there is no merge base at all', async () => {
  // A history with no common ancestor — what a re-created origin looks like. It reaches the
  // same `ahead > 0` branch as `diverged`, and only `merge-base` separates the two, so a port
  // that ignored its exit code would call this one diverged and advise a rebase that cannot run.
  git(OTHER, 'checkout', '-q', '--orphan', 'fresh');
  git(OTHER, 'rm', '-rq', '--cached', '.');
  commit(OTHER, 'unrelated-root.txt');
  git(OTHER, 'push', '-qf', 'origin', 'fresh:main');
  const [code] = await U.measureUpstream();
  assert.equal(code, 'unrelated');
});

test('a fetch that fails is fetch_failed, and the reason is carried out', async () => {
  git(CO, 'remote', 'set-url', 'origin', path.join(sb.path, 'no-such-origin.git'));
  try {
    const [code, behind, err] = await U.measureUpstream();
    assert.equal(code, 'fetch_failed');
    assert.equal(behind, 0);
    // The tail is git's own words. `fetchStreaming` builds it only after the reader has drained
    // the pipe — a tail built at process exit loses the message and the caller then claims the
    // fetch produced nothing. The reference has a dedicated test for that; here the property is
    // load-bearing in the ordinary failure path, so it is asserted where it is used.
    assert.ok(err, 'a failed fetch reported no reason at all');
    assert.match(err, /does not appear to be a git repository|repository .* not found|not found/i);
  } finally { git(CO, 'remote', 'set-url', 'origin', ORIGIN); }
});

// ---------------------------------------------------------------------------------------------
// `PullAndValidateTests` — fast-forward, doctor-gate, roll back exactly.
//
// A SECOND fixture, because these run destructively forward through a repository's history and
// the five above leave theirs on an orphan root. The reference mocks `_git` AND `_run_doctor`;
// here both are real — `pullAndValidate` merges with real git and `runDoctor` spawns the copy's
// own `bin/geneseed-cli.mjs doctor --all --no-bundle`, so the rollback is proven against a tree
// the doctor genuinely rejects rather than against a mock told to say no.
//
// ⚠ ORDERED AND CUMULATIVE, like `MeasureUpstream` above and for a sharper reason: the collision
// and the fast-forward are the SAME upstream commit, blocked and then allowed. That is what makes
// the collision arm mean something — a merge that was going to fail anyway proves nothing about a
// guard.

const CO2 = path.join(sb.path, 'checkout2');
const ORIGIN2 = path.join(sb.path, 'origin2.git');
const OTHER2 = path.join(sb.path, 'other2');

copyCheckout(CO2, {});
git(sb.path, 'init', '--bare', '-b', 'main', ORIGIN2);
git(CO2, 'init', '-b', 'main');
git(CO2, 'config', 'user.email', 'fixture@geneseed.test');
git(CO2, 'config', 'user.name', 'fixture');
git(CO2, 'add', '-A');
git(CO2, 'commit', '-qm', 'the copied checkout');
git(CO2, 'remote', 'add', 'origin', ORIGIN2);
git(CO2, 'push', '-q', '-u', 'origin', 'main');
git(sb.path, 'clone', '-q', ORIGIN2, OTHER2);
git(OTHER2, 'config', 'user.email', 'fixture@geneseed.test');
git(OTHER2, 'config', 'user.name', 'fixture');

const U2 = await import(pathToFileURL(path.join(CO2, 'js', 'update.mjs')).href);
const COLLIDE = 'an-upstream-addition.txt';

test('a pull blocked by an untracked collision returns collision and changes nothing', () => {
  commit(OTHER2, COLLIDE);
  git(OTHER2, 'push', '-q');
  git(CO2, 'fetch', '-q');
  // The same name, untracked and with different content: git refuses rather than overwrite it.
  fs.writeFileSync(path.join(CO2, COLLIDE), 'the user had this here first\n');
  const before = git(CO2, 'rev-parse', 'HEAD');

  const [ok, code, msg] = U2.pullAndValidate(() => {});
  assert.equal(ok, false);
  assert.equal(code, 'collision');
  assert.ok(/collides with a local untracked file/.test(msg), msg);
  assert.equal(git(CO2, 'rev-parse', 'HEAD'), before, 'a blocked pull still moved HEAD');
  assert.equal(fs.readFileSync(path.join(CO2, COLLIDE), 'utf8'), 'the user had this here first\n',
    "the blocked pull overwrote the user's file, which is the thing it refused to do");
});

test('a clean fast-forward passes the doctor and does not roll back', () => {
  // The SAME commit as above, now unblocked. `runDoctor` really spawns and really passes, so
  // this also asserts the copied checkout is a valid Geneseed source tree — which is what makes
  // the rollback test below a statement about the pulled commit rather than about the fixture.
  fs.unlinkSync(path.join(CO2, COLLIDE));
  const before = git(CO2, 'rev-parse', 'HEAD');

  const [ok, code] = U2.pullAndValidate(() => {});
  assert.equal(ok, true, 'a clean fast-forward onto a healthy tree was rejected');
  assert.equal(code, 'ready');
  assert.notEqual(git(CO2, 'rev-parse', 'HEAD'), before, 'the fast-forward did not happen');
  assert.ok(fs.existsSync(path.join(CO2, COLLIDE)), 'the pulled file never arrived');
});

test('a pulled source that fails the doctor is rolled back to the exact previous commit', () => {
  // The property the whole verb exists for: an upgrade may never leave a user on a source tree
  // that does not validate. The fault is a REAL one the doctor really rejects — a theme missing
  // a template key, which is the theme-parity gate — pushed upstream and pulled in.
  const themePath = path.join(OTHER2, 'themes', 'neutral.json');
  const theme = JSON.parse(fs.readFileSync(themePath, 'utf8'));
  assert.ok('VOICE' in theme, 'neutral.json no longer has a VOICE key — this fixture is stale');
  delete theme.VOICE;
  fs.writeFileSync(themePath, `${JSON.stringify(theme, null, 2)}\n`);
  git(OTHER2, 'add', '-A');
  git(OTHER2, 'commit', '-qm', 'break theme parity');
  git(OTHER2, 'push', '-q');
  git(CO2, 'fetch', '-q');

  const before = git(CO2, 'rev-parse', 'HEAD');
  const [ok, code, msg] = U2.pullAndValidate(() => {});
  assert.equal(ok, false);
  assert.equal(code, 'doctor_fail');
  assert.match(msg, /rolled back/);
  // EXACT, not merely "not the broken tip": the reference asserts `reset --hard <oldsha>` and
  // the sha is the whole claim — rolling back to anything else silently moves the user.
  assert.equal(git(CO2, 'rev-parse', 'HEAD'), before, 'the rollback did not land on the old sha');
  assert.ok(!fs.existsSync(path.join(CO2, 'A-FILE-THAT-SHOULD-NOT-EXIST')));
  const restored = JSON.parse(fs.readFileSync(path.join(CO2, 'themes', 'neutral.json'), 'utf8'));
  assert.ok('VOICE' in restored, 'the rollback left the broken theme in the working tree');
});

// ---------------------------------------------------------------------------------------------
// `NoCellCanReachTheNetwork` — the positive control for the ban this whole file runs under.

test('a real fetch over https is refused by transport, not by luck', () => {
  // Declaring a ban and running under one are two properties and only the second is worth
  // anything. This runs the REAL `fetchStreaming` — no mock, no seam — against a network remote
  // and requires git to refuse it in its own argument handling, before a connection is
  // attempted. Without GIT_ALLOW_PROTOCOL=file the same call fetches, so the gate goes red the
  // moment the ban stops being applied, here or in CI.
  git(CO2, 'remote', 'set-url', 'origin', 'https://github.com/Arylmera/Geneseed.git');
  try {
    return U2.fetchStreaming().then(([code, out]) => {
      assert.notEqual(code, 0, 'the fetch SUCCEEDED — the network ban is not being applied');
      assert.match(out, /not allowed/,
        `git failed for some reason other than the transport ban. git said: ${out}`);
    });
  } finally { git(CO2, 'remote', 'set-url', 'origin', ORIGIN2); }
});

test('git missing from PATH also classifies as fetch_failed', async () => {
  // The reference's `rc None` seam. Reached here through the real lookup, and it is a distinct
  // arm: `fetchStreaming` returns before spawning anything, so `measureUpstream` must classify
  // a null return exactly as it classifies a non-zero one.
  const saved = process.env.PATH;
  process.env.PATH = '';
  try {
    const [code, , err] = await U.measureUpstream();
    assert.equal(code, 'fetch_failed');
    assert.match(err, /git is not installed/);
  } finally { process.env.PATH = saved; }
});
