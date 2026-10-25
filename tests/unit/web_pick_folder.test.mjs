/**
 * `/api/pick-folder`'s DISPATCH and its non-desktop error path — the two arms this suite may
 * safely drive.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT TEST: the real dialog. `apiPickFolder` (see
 * `js/web/actions.mjs`) spawns a REAL OS folder chooser on win32/darwin, with no way to
 * supply an answer short of a human at the keyboard — and this repo's spawn allow-list
 * (`tests/unit/hook_cli.test.mjs`'s `ALLOWED_SPAWNS`) is a STATIC source scan, not an
 * injection point, matching every other spawning `js/web/` module (none of them are exercised
 * through a mocked `child_process` either — see `tests/unit/web_jobs.test.mjs`).
 *
 * So this overrides `process.platform` to a value with NO dialog branch at all, which
 * exercises the real handler, the real dispatch, and the real response shape without ever
 * calling `spawn` — the same technique `apiPickFolder`'s own platform check is built on.
 * `process.platform` is a plain configurable data property (verified: `writable: false,
 * configurable: true`), so `Object.defineProperty` overrides it for the span of one request
 * and this test restores it in a `finally`, whatever the assertion below does.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import test from 'node:test';

import { makeHandler } from '../../js/web/handler.mjs';
import { JobManager } from '../../js/web/jobs.mjs';

test('POST /api/pick-folder dispatches, and a platform with no dialog branch answers 200 '
  + 'with an error instead of 501 or a hang', async () => {
  // `state: {}` — a bare object, not `webState(...)`. `apiPickFolder` reads no state at all
  // (its whole POST body is ignored too), so the route under test never touches it; building
  // a real `webState()` here would only add a filesystem dependency this test does not need.
  const holder = {};
  const srv = http.createServer(makeHandler({}, new JobManager(), 'tok', 'nowhere', holder));
  holder.srv = srv;
  await new Promise((resolve) => { srv.listen(0, '127.0.0.1', resolve); });
  const realPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'sunos', configurable: true });
  try {
    const base = `http://127.0.0.1:${srv.address().port}`;
    const r = await fetch(`${base}/api/pick-folder`, {
      method: 'POST',
      headers: { 'X-Geneseed-Token': 'tok', 'Content-Type': 'application/json' },
      body: '{}',
    });
    // 404 here would mean the route fell through to `POST_ROUTES`'s miss arm instead of the
    // inline branch in `doPost`; 500 would mean the platform check raised instead of
    // answering. 200 + this exact body is the whole contract the client's `pickFolder()` (in
    // `web/src/api/index.js`) relies on for its `{error}` arm.
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { error: 'no native folder dialog on this platform' });
  } finally {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
    srv.closeAllConnections();
    srv.close();
  }
});

// ONE DIALOG AT A TIME. A second click while a dialog is open would stack a second dialog
// behind the first, so `apiPickFolder` is `singleFlight(...)`: a concurrent call answers busy
// at once, with an `error` the three clients (which read only `path` / `error`) can show. The
// latch is cleared inside the wrapped `done`, so it lasts exactly as long as a pick is pending —
// a fn that answers synchronously (no powershell, no dialog branch) never holds it. The fake fn
// here never spawns anything.
test('singleFlight answers busy while one call is pending, and only then', async () => {
  const actions = await import('../../js/web/actions.mjs');
  assert.equal(typeof actions.singleFlight, 'function', 'actions.mjs exports no singleFlight');
  let held = null;
  let runs = 0;
  const pick = actions.singleFlight((done) => { runs += 1; held = done; });
  const answers = [];
  pick((r) => answers.push(['first', r]));
  pick((r) => answers.push(['second', r]));
  assert.deepEqual(answers,
    [['second', { busy: true, error: 'a folder dialog is already open on this machine' }]]);
  held({ path: 'C:\\picked' });
  pick((r) => answers.push(['third', r]));
  assert.equal(runs, 2, 'the call after the first resolved did not run the picker');
  held({ cancelled: true });
  assert.deepEqual(answers, [
    ['second', { busy: true, error: 'a folder dialog is already open on this machine' }],
    ['first', { path: 'C:\\picked' }],
    ['third', { cancelled: true }],
  ]);

  let syncRuns = 0;
  const sync = actions.singleFlight((done) => { syncRuns += 1; done({ error: 'none here' }); });
  const syncAnswers = [];
  sync((r) => syncAnswers.push(r));
  sync((r) => syncAnswers.push(r));
  assert.equal(syncRuns, 2, 'a synchronous answer latched the flag');
  assert.deepEqual(syncAnswers, [{ error: 'none here' }, { error: 'none here' }]);

  // A throw before any child exists releases the latch too, or one bad call shuts the picker.
  let throwRuns = 0;
  const throws = actions.singleFlight(() => { throwRuns += 1; throw new Error('boom'); });
  assert.throws(() => throws(() => {}), /boom/);
  assert.throws(() => throws(() => {}), /boom/, 'a throw latched the flag');
  assert.equal(throwRuns, 2);
});

// The wrapper only helps if the route uses it. A SOURCE ASSERTION: off a desktop the real picker
// answers at once, so no call here can tell a wrapped picker from a bare one.
test('apiPickFolder is the single-flight picker', () => {
  const src = fs.readFileSync(new URL('../../js/web/actions.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('export const apiPickFolder = singleFlight(pickFolderOnce);'),
    'apiPickFolder is no longer wrapped in singleFlight');
});
