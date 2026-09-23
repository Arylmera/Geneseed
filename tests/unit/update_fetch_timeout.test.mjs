// `fetchStreaming`'s deadline: a fetch that never answers is killed at 30 s.
//
// ITS OWN FILE ON PURPOSE. It takes the full 30 seconds (the floor is deliberate, see below), and
// `node --test` runs a file's tests in sequence but files in parallel. Inside
// `update_git.test.mjs` it ran after two doctor-gated pulls and set the suite's wall clock; here
// it overlaps with everything else.
//
// The fixture is the smallest one the property needs: a copied checkout (so `update.mjs`'s ROOT
// is the copy, not the developer's tree — same seam as `update_git.test.mjs`) whose `origin` is an
// ssh URL behind an SSH command that never speaks. No socket is opened by anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { makeSandbox, sandboxProcessHome, restoreProcessHome } from '../helpers/sandbox.mjs';
import { copyCheckout } from '../helpers/cli_golden.mjs';

sandboxProcessHome();
const sb = makeSandbox('gs-updfetch-');
const CO = path.join(sb.path, 'checkout');

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0,
    `fixture: git ${args.join(' ')} in ${cwd} -> ${r.status}\n${r.stderr || ''}`);
}

copyCheckout(CO, {});
git(CO, 'init', '-q', '-b', 'main');
git(CO, 'remote', 'add', 'origin', 'ssh://fixture.invalid/repo.git');

const U = await import(pathToFileURL(path.join(CO, 'js', 'maintain', 'update.mjs')).href);

test.after(() => {
  restoreProcessHome();
  sb.cleanup();
});

test('a fetch that produces nothing is killed, returns null, and says so', async () => {
  // THE HANG IS REAL AND SO IS THE KILL. The reference mocks `_fetch_timeout` down to 1 second;
  // there is no seam here and the floor is deliberate — `fetchTimeout()` is `max(30, …)`, so a
  // user cannot set a nonsense deadline and neither can a test. MEASURED COST: this test takes
  // the full 30 seconds and is by a wide margin the slowest in the suite. It is kept at full
  // price because the property is the most user-visible one in the module: without it a fetch
  // that never answers hangs `geneseed web`'s daemon forever, which is the bug `_kill_tree` was
  // written for.
  //
  // The hang is git's own, not a stand-in: an `ssh://` origin whose SSH command is a process
  // that never speaks. git spawns it and blocks (measured: still blocked at 6 s under a plain
  // spawn, killed only by the harness's own timeout), which is exactly the shape of a fetch
  // against a black-holed network — and no socket is opened by anything.
  const savedProtocol = process.env.GIT_ALLOW_PROTOCOL;
  const savedSsh = process.env.GIT_SSH_COMMAND;
  const savedTimeout = process.env.GENESEED_NET_TIMEOUT;
  process.env.GIT_ALLOW_PROTOCOL = 'file:ssh';
  process.env.GIT_SSH_COMMAND = `"${process.execPath}" -e "setInterval(()=>{},1000)"`;
  process.env.GENESEED_NET_TIMEOUT = '30';
  const logged = [];
  try {
    const started = Date.now();
    const [rc] = await U.fetchStreaming((m) => logged.push(m));
    const elapsed = Date.now() - started;
    assert.equal(rc, null, 'a timed-out fetch must be null, not a status code');
    assert.ok(logged.some((m) => /killed it/.test(m)),
      `the kill was silent:\n${logged.join('\n')}`);
    // The deadline is the reason it returned, not a fast failure that happened to be null:
    // an origin git rejected outright would come back in milliseconds with the same rc.
    assert.ok(elapsed >= 29_000, `it returned after ${elapsed}ms — that was not the deadline`);
    // The heartbeat, which shares the same 250 ms timer and is the only sign of life a user
    // gets during a long fetch.
    assert.ok(logged.some((m) => /still fetching \(\d+s elapsed\)/.test(m)),
      `no heartbeat during a 30-second fetch:\n${logged.join('\n')}`);
  } finally {
    if (savedProtocol === undefined) delete process.env.GIT_ALLOW_PROTOCOL;
    else process.env.GIT_ALLOW_PROTOCOL = savedProtocol;
    if (savedSsh === undefined) delete process.env.GIT_SSH_COMMAND;
    else process.env.GIT_SSH_COMMAND = savedSsh;
    if (savedTimeout === undefined) delete process.env.GENESEED_NET_TIMEOUT;
    else process.env.GENESEED_NET_TIMEOUT = savedTimeout;
  }
});
