// THE OVERVIEW'S REBUILD NAMES ITS INSTALLS. `POST /api/actions/rebuild` with
// `{installs: [{host, path}]}` rebuilds exactly those, each with the argv `rebuild-all` replays
// for it (`installProfile`), and a pair that is not an ACTIVE detected install — unknown, the
// wrong host, a path spelled differently — refuses the whole request at 409 with no job started.
// Driven through the real handler; the job manager is a stub, so nothing is ever built.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeHandler } from '../../js/web/handler.mjs';
import { webState } from '../../js/web/state.mjs';
import { installProfile } from '../../js/build/generate.mjs';
import { DISABLED_STASH, GLOBAL_MANIFEST } from '../../js/hosts/hosts.mjs';
import { installState } from '../../js/hosts/installs.mjs';
import { sandboxProcessHome, restoreProcessHome } from '../helpers/sandbox.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

let home;
let savedOc;
let dir;
let st;
let srv;
const started = [];
before(async () => {
  home = sandboxProcessHome();
  savedOc = process.env.OPENCODE_CONFIG_DIR;
  // An ACTIVE OpenCode global install: a manifest is all `installState` needs. No emit.
  dir = path.join(home, 'oc');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, GLOBAL_MANIFEST), JSON.stringify({ owned: [] }));
  process.env.OPENCODE_CONFIG_DIR = dir;
  st = webState('neutral');
  const jm = {
    busy: false, recent: () => [],
    start: (action, cmds) => { started.push([action, cmds]); return 'j1'; },
  };
  srv = http.createServer(makeHandler(st, jm, 'tok', 'nowhere', {}));
  await new Promise((r) => { srv.listen(0, '127.0.0.1', r); });
});
after(() => {
  srv.close();
  if (savedOc === undefined) delete process.env.OPENCODE_CONFIG_DIR;
  else process.env.OPENCODE_CONFIG_DIR = savedOc;
  restoreProcessHome();
});

const post = async (body) => {
  const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/actions/rebuild`, {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'X-Geneseed-Token': 'tok', 'Content-Type': 'application/json' },
  });
  return { status: r.status, json: await r.json() };
};

test('a known active install starts one job of exactly its rebuild-all argv', async () => {
  started.length = 0;
  st.daemonStale = () => false;
  // Named twice: one install, one step.
  const r = await post({ installs: [{ host: 'opencode', path: dir }, { host: 'opencode', path: dir }] });
  assert.equal(r.status, 202);
  assert.deepEqual(r.json, { job_id: 'j1' });
  const argv = installProfile('opencode', 'global', dir).argv;
  assert.deepEqual(started, [['rebuild',
    [[process.execPath, path.join(ROOT, 'bin', 'build-driver.mjs'), ...argv]]]]);
  // The reference itself, read literally: a global install is rebuilt INTO its own folder.
  const cmd = started[0][1][0];
  assert.equal(cmd[cmd.indexOf('--config-dir') + 1], dir);
});

test('any pair that is not an active detected install refuses at 409 and starts nothing', async () => {
  started.length = 0;
  const bad = [
    { installs: [{ host: 'opencode', path: path.join(home, 'nowhere') }] },
    { installs: [{ host: 'claude', path: dir }] },
    { installs: [{ host: 'opencode', path: dir.toUpperCase() }] },
    { installs: [{ host: 'opencode', path: `${dir}${path.sep}` }] },
    // One good entry does not carry a bad one: all or nothing.
    { installs: [{ host: 'opencode', path: dir }, { host: 'opencode', path: `${dir}x` }] },
    { installs: { host: 'opencode', path: dir } },
    { installs: [] },
    { installs: ['opencode'] },
    {},
  ];
  for (const body of bad) {
    const r = await post(body);
    assert.equal(r.status, 409, JSON.stringify(body));
    assert.ok(typeof r.json.error === 'string' && r.json.error, JSON.stringify(r.json));
  }
  assert.deepEqual(started, []);
});

test('a deactivated install is refused, never rebuilt', async () => {
  started.length = 0;
  // The stash folder a deactivate leaves is what makes an OpenCode install `disabled`.
  const stash = path.join(dir, DISABLED_STASH);
  fs.mkdirSync(stash);
  try {
    assert.equal(installState(dir, 'opencode', 'global'), 'disabled');
    const r = await post({ installs: [{ host: 'opencode', path: dir }] });
    assert.equal(r.status, 409);
    assert.deepEqual(started, []);
  } finally { fs.rmSync(stash, { recursive: true }); }
});

test('a legacy carrier is refused, never rebuilt', async () => {
  started.length = 0;
  const carrier = path.join(dir, 'AGENT.md');
  fs.writeFileSync(carrier, '# Rules\nprocess 8\n');
  try {
    const r = await post({ installs: [{ host: 'opencode', path: dir }] });
    assert.equal(r.status, 409);
    assert.match(r.json.error, /predates the comms pack/);
    assert.deepEqual(started, []);
  } finally { fs.rmSync(carrier); }
});

test('a stale server refuses the per-install rebuild and starts nothing', async () => {
  // The argv is built by THIS process's installProfile but run by the new build-driver on
  // disk; after a pull the two can disagree on an axis, so the console must restart first.
  // build-all is unaffected (it spawns the new CLI, which builds the profiles itself).
  started.length = 0;
  st.daemonStale = () => true;
  try {
    const r = await post({ installs: [{ host: 'opencode', path: dir }] });
    assert.equal(r.status, 422);
    assert.match(r.json.error, /restart/);
    assert.equal(started.length, 0);
  } finally { st.daemonStale = () => false; }
});
