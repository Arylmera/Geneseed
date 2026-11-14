// THE CONSOLE'S PROFILES TAB (`js/web/profiles-api.mjs`, spec D38, D39). `GET /api/profiles`
// lists both profile sources, the installs that follow each, and a preview of an apply; the two
// jobs, `profile-apply` and `profile-save`, run the CLI's own verb and refuse a bad body at 400.
//
// Driven through the real handler with a stub job manager, so nothing is ever built by a job.
// The process home is a sandbox (`sandboxProcessHome`), which moves the machine tier too: the
// Personal profiles read here are the sandbox's, never the real `~/.config/geneseed/profiles`.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { makeHandler } from '../../js/web/handler.mjs';
import { webState } from '../../js/web/state.mjs';
import { apiProfiles, followsProfile } from '../../js/web/profiles-api.mjs';
import { PROFILES_DIR, profileBuildArgs, loadProfile } from '../../js/maintain/profiles.mjs';
import { resolvePath } from '../../js/hosts/hosts.mjs';
import { cellEnv, makeSandbox, restoreProcessHome, sandboxProcessHome } from '../helpers/sandbox.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, 'bin', 'geneseed-cli.mjs');

let home;
let cfg;
let personal;
let srv;
let st;
const started = [];
/** Every host present: the tests do not depend on what this machine has installed. */
const ALL = () => ['opencode', 'claude', 'bob', 'openclaude'].map(() => ['x', true, 'u', null]);

before(async () => {
  home = sandboxProcessHome();
  cfg = path.join(home, '.claude');
  personal = path.join(home, '.config', 'geneseed', 'profiles');
  fs.mkdirSync(personal, { recursive: true });
  const starter = loadProfile('starter', { personalDir: personal }).profile;
  fs.writeFileSync(path.join(personal, 'mine.json'), JSON.stringify({ ...starter, hosts: ['claude'], theme: 'pirate' }));
  fs.writeFileSync(path.join(personal, 'starter.json'), JSON.stringify(starter));
  // A real Claude global install that follows starter: the argv a starter apply builds.
  const built = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'build-driver.mjs'), ...profileBuildArgs(starter, 'claude')],
    { cwd: home, env: cellEnv(home), encoding: 'utf8', windowsHide: true });
  assert.equal(built.status, 0, built.stderr);
  st = webState('neutral');
  const jm = { busy: false, recent: () => [], start: (action, cmds) => { started.push([action, cmds]); return 'j1'; } };
  srv = http.createServer(makeHandler(st, jm, 'tok', 'nowhere', {}));
  await new Promise((r) => { srv.listen(0, '127.0.0.1', r); });
});
after(() => {
  srv?.close();
  restoreProcessHome();
});

const req = async (method, p, body) => {
  const r = await fetch(`http://127.0.0.1:${srv.address().port}${p}`, {
    method, ...(body ? { body: JSON.stringify(body) } : {}),
    headers: { 'X-Geneseed-Token': 'tok', 'Content-Type': 'application/json' },
  });
  return { status: r.status, json: await r.json() };
};

test('the list names both sources, the shadowed file, and the installs that follow each', () => {
  const r = apiProfiles(st, '/api/profiles', { src: { personalDir: personal }, tools: ALL });
  assert.deepEqual(r.profiles.map((p) => [p.name, p.source, p.shadowed]), [
    ['guillaume-claude-global', 'shipped', false], ['starter', 'shipped', false],
    ['mine', 'personal', false], ['starter', 'personal', true],
  ]);
  const by = (name, source) => r.profiles.find((p) => p.name === name && p.source === source);
  assert.match(by('starter', 'personal').error, /a shipped profile has this name/);
  assert.deepEqual(by('starter', 'shipped').matches, [{ host: 'claude', scope: 'global', path: cfg }]);
  assert.deepEqual(by('mine', 'personal').matches, []);
  assert.deepEqual(by('mine', 'personal').diff, [
    { key: 'hosts', base: 'bob,claude,openclaude,opencode', now: 'claude' }, { key: 'theme', base: 'neutral', now: 'pirate' },
  ]);
  assert.deepEqual(by('guillaume-claude-global', 'shipped').gatesOff, ['deletionGate', 'ownershipGate', 'externalGate']);
  // The install's own difference from starter is what `profile save` would print: a saved
  // profile lists its one host, so `hosts` differs even from the profile the install follows.
  assert.deepEqual(r.installs, [{ host: 'claude', scope: 'global', path: cfg, matches: ['starter'],
    diff: [{ key: 'hosts', base: 'bob,claude,openclaude,opencode', now: 'claude' }] }]);
  assert.equal(r.base, 'starter');
  assert.equal(r.personalDir, personal);
  assert.equal(r.shippedDir, PROFILES_DIR);
  assert.equal(r.shippedWritable, true);
});

test('a global preview lists, per profile host, the install there and what a build puts back', () => {
  const r = apiProfiles(st, '/api/profiles?profile=mine', { src: { personalDir: personal }, tools: ALL });
  assert.deepEqual(r.preview, {
    name: 'mine', scope: 'global', project: null, rows: [{
      host: 'claude', label: 'Claude Code', present: true, state: 'active', root: cfg,
      changes: [{ name: 'theme', from: 'neutral', to: 'pirate' }], layering: null,
    }],
  });
  const none = apiProfiles(st, '/api/profiles?profile=starter', { src: { personalDir: personal }, tools: ALL });
  assert.deepEqual(none.preview.rows.map((x) => [x.host, x.state, x.changes.length]),
    [['opencode', 'absent', 0], ['claude', 'active', 0], ['bob', 'absent', 0], ['openclaude', 'absent', 0]]);
  assert.match(apiProfiles(st, '/api/profiles?profile=nope', { src: { personalDir: personal }, tools: ALL }).preview.error,
    /no profile 'nope'/);
});

// D39: in project scope, a host whose global install is active names that install and its armed
// gates that still run in the folder. starter turns the ownership gate off, so it is not named.
test('a project preview names the global install that keeps running beside it (D39)', () => {
  const sb = makeSandbox('gs-webprof-');
  try {
    const q = `/api/profiles?profile=starter&project=${encodeURIComponent(sb.path)}`;
    const r = apiProfiles(st, q, { src: { personalDir: personal }, tools: ALL });
    assert.equal(r.preview.scope, 'project');
    assert.equal(r.preview.project, resolvePath(sb.path));
    const claude = r.preview.rows.find((x) => x.host === 'claude');
    assert.deepEqual([claude.state, claude.changes], ['absent', []]);
    assert.deepEqual(claude.layering, { root: cfg, gates: ['Secrets gate', 'External gate', 'Test note'] });
    assert.equal(r.preview.rows.find((x) => x.host === 'opencode').layering, null);
    const bad = apiProfiles(st, `/api/profiles?profile=starter&project=${encodeURIComponent(path.join(sb.path, 'no'))}`,
      { src: { personalDir: personal }, tools: ALL });
    assert.match(bad.preview.error, /^not a folder: /);
  } finally { sb.cleanup(); }
});

// "Follows": equal on every build setting. `hosts`, `login` and `description` are no install
// setting; `sharedTier` counts on a project install only (a global apply ignores it, D37).
test('an install follows a profile on its build settings alone', () => {
  const starter = loadProfile('starter', { personalDir: personal }).profile;
  const install = { ...starter, hosts: ['claude'], description: 'x', login: true, sharedTier: false };
  assert.equal(followsProfile(install, 'global', starter), true);
  assert.equal(followsProfile(install, 'global', { ...starter, sharedTier: true }), true);
  assert.equal(followsProfile(install, 'project', { ...starter, sharedTier: true }), false);
  assert.equal(followsProfile(install, 'global', { ...starter, login: false }), true);
  assert.equal(followsProfile(install, 'global', { ...starter, posture: 'expert' }), false);
});

test('GET /api/profiles is served, machine-wide', async () => {
  const r = await req('GET', '/api/profiles');
  assert.equal(r.status, 200);
  assert.ok(r.json.profiles.some((p) => p.name === 'mine' && p.source === 'personal'));
  // A named install is ignored, not refused (MACHINE_GETS).
  assert.equal((await req('GET', '/api/profiles?host=nope&path=%2Fno')).status, 200);
});

test('profile-apply starts the CLI verb; a bad body is a 400 and starts nothing', async () => {
  started.length = 0;
  const ok = await req('POST', '/api/actions/profile-apply', { name: 'starter', hosts: ['claude', 'opencode'] });
  assert.equal(ok.status, 202);
  assert.deepEqual(started, [['profile-apply', [[process.execPath, CLI, 'profile', 'apply', 'starter', '--hosts', 'claude,opencode']]]]);
  const sb = makeSandbox('gs-webprof-');
  try {
    started.length = 0;
    assert.equal((await req('POST', '/api/actions/profile-apply', { name: 'mine', hosts: ['claude'], project: sb.path })).status, 202);
    assert.deepEqual(started[0][1][0].slice(2), ['profile', 'apply', 'mine', '--hosts', 'claude', '--project', resolvePath(sb.path)]);
  } finally { sb.cleanup(); }
  started.length = 0;
  for (const [body, want] of [
    [{ name: 'nope', hosts: ['claude'] }, /no profile 'nope'/],
    [{ name: 'mine', hosts: [] }, /hosts must be a non-empty list/],
    [{ name: 'mine', hosts: ['opencode'] }, /not in profile 'mine': opencode/],
    [{ name: 'mine', hosts: ['claude'], project: path.join(home, 'no-such') }, /not a folder/],
  ]) {
    const r = await req('POST', '/api/actions/profile-apply', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.json.error, want);
  }
  assert.deepEqual(started, []);
});

test('profile-save starts the CLI verb from an active install; every refusal is a 400', async () => {
  started.length = 0;
  const from = { host: 'claude', path: cfg };
  assert.equal((await req('POST', '/api/actions/profile-save', { name: 'team', from })).status, 202);
  assert.deepEqual(started[0], ['profile-save', [[process.execPath, CLI, 'profile', 'save', 'team', '--from', 'claude-global']]]);
  started.length = 0;
  // This checkout is a git clone (a worktree), so a shipped save is offered.
  assert.equal((await req('POST', '/api/actions/profile-save', { name: 'team', from, shipped: true })).status, 202);
  assert.deepEqual(started[0][1][0].slice(-1), ['--shipped']);
  started.length = 0;
  assert.equal((await req('POST', '/api/actions/profile-save', { name: 'mine', from, force: true })).status, 202);
  assert.deepEqual(started[0][1][0].slice(-1), ['--force']);
  started.length = 0;
  for (const [body, want] of [
    [{ name: '../x', from }, /is not a profile name/],
    [{ name: 'team', from: { host: 'claude', path: path.join(home, 'elsewhere') } }, /from must name an active install/],
    [{ name: 'starter', from }, /'starter' is already a shipped profile/],
    [{ name: 'mine', from }, /'mine' already exists .* pick another name, or replace it/],
    [{ name: 'mine', from, shipped: true }, /'mine' is already a personal profile/],
  ]) {
    const r = await req('POST', '/api/actions/profile-save', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.json.error, want);
  }
  assert.deepEqual(started, []);
});
