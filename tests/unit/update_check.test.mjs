// updateStatus — the Overview's "newer release" chip. No case here reaches the network: every
// call injects a fetcher, and the default one is refused under `node --test` anyway.
//
// The rules, each pinned below:
// - semver compares x.y.z numerically (4.10.0 is newer than 4.9.9) and anything else
//   (a pre-release tag, garbage) is never "newer";
// - the first poll answers unknown at once and starts one fetch; the next poll reads it;
// - `available` is true only when latest is strictly greater: an equal release is "latest",
//   and a checkout ahead of the last release (current 4.2.0, npm 4.1.0) never shows one;
// - a failed fetch is `latest: null`, retried after an hour rather than a day;
// - while a fetch is in flight, another poll does not start a second one.
import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import path from 'node:path';

import { apiUpdate } from '../../js/web/api.mjs';
import { gitBehind, installKind, semverGreater, updateStatus } from '../../js/web/update-check.mjs';
import { withSandbox } from '../helpers/sandbox.mjs';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const settle = () => new Promise((r) => setImmediate(r));

test('semver compares numerically and refuses what it cannot parse', () => {
  assert.equal(semverGreater('4.10.0', '4.9.9'), true);
  assert.equal(semverGreater('4.1.0', '4.1.0'), false);
  assert.equal(semverGreater('4.1.0', '4.2.0'), false);
  assert.equal(semverGreater('4.2.0-rc.1', '4.1.0'), false);
  assert.equal(semverGreater(null, '4.1.0'), false);
});

test('the first poll answers unknown and fetches once; the next poll has the answer', async () => {
  const st = {};
  let calls = 0;
  const fetcher = async () => { calls += 1; return '4.2.0'; };
  assert.deepEqual(updateStatus(st, '4.1.0', { fetcher, now: 0 }),
    { current: '4.1.0', latest: null, available: null, checked_at: null });
  updateStatus(st, '4.1.0', { fetcher, now: 1 });
  await settle();
  assert.equal(calls, 1, 'a poll during the fetch must not start a second one');
  assert.deepEqual(updateStatus(st, '4.1.0', { fetcher, now: 2 }),
    { current: '4.1.0', latest: '4.2.0', available: true, checked_at: 0 });
  assert.equal(calls, 1, 'a fresh answer is not re-asked');
});

test('an equal release and a checkout ahead of npm both say nothing is available', async () => {
  const st = {};
  updateStatus(st, '4.2.0', { fetcher: async () => '4.1.0', now: 0 });
  await settle();
  assert.equal(updateStatus(st, '4.2.0', { fetcher: async () => '4.1.0', now: 1 }).available, false);
  assert.equal(updateStatus(st, '4.1.0', { fetcher: async () => '4.1.0', now: 1 }).available, false);
});

test('a failed fetch is null, and is retried after an hour', async () => {
  const st = {};
  let calls = 0;
  const fetcher = async () => { calls += 1; throw new Error('proxy'); };
  updateStatus(st, '4.1.0', { fetcher, now: 0 });
  await settle();
  assert.equal(updateStatus(st, '4.1.0', { fetcher, now: HOUR - 1 }).latest, null);
  assert.equal(calls, 1, 'not retried inside the hour');
  updateStatus(st, '4.1.0', { fetcher, now: HOUR + 1 });
  await settle();
  assert.equal(calls, 2, 'retried once the hour is up');
});

// ---------------------------------------------------------------------------------------------
// installKind — which route the Update button takes. The rules:
// - a `.git` (a folder in a clone, a file in a worktree) is `git`, and npm is never asked;
// - a package whose parent folder is `npm root -g` is `npm-global`;
// - a `node_modules` that is NOT the global root (a project's own, an npx cache) is `other`,
//   and so is a copy when npm is absent (`npmRoot` answers null);
// - a parent that is not a `node_modules` at all is `other`, without asking npm.

test('a .git folder or file is a git install, and npm is never asked', () => withSandbox('kind-', (d) => {
  let asked = 0;
  const npmRoot = () => { asked += 1; return path.join(d, 'node_modules'); };
  const clone = path.join(d, 'clone');
  fs.mkdirSync(path.join(clone, '.git'), { recursive: true });
  const wt = path.join(d, 'node_modules', 'geneseed');
  fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: elsewhere\n');
  assert.equal(installKind({ root: clone, npmRoot }), 'git');
  assert.equal(installKind({ root: wt, npmRoot }), 'git');
  assert.equal(asked, 0);
}));

test('the package under npm root -g is npm-global; any other node_modules is other', () => withSandbox('kind-', (d) => {
  const g = path.join(d, 'global', 'node_modules');
  const proj = path.join(d, 'proj', 'node_modules');
  fs.mkdirSync(path.join(g, 'geneseed'), { recursive: true });
  fs.mkdirSync(path.join(proj, 'geneseed'), { recursive: true });
  assert.equal(installKind({ root: path.join(g, 'geneseed'), npmRoot: () => g }), 'npm-global');
  assert.equal(installKind({ root: path.join(proj, 'geneseed'), npmRoot: () => g }), 'other');
  assert.equal(installKind({ root: path.join(g, 'geneseed'), npmRoot: () => null }), 'other');
}));

test('a copy outside any node_modules is other, and npm is not asked for it', () => withSandbox('kind-', (d) => {
  let asked = 0;
  fs.mkdirSync(path.join(d, 'vendor', 'geneseed'), { recursive: true });
  assert.equal(installKind({ root: path.join(d, 'vendor', 'geneseed'),
    npmRoot: () => { asked += 1; return path.join(d, 'vendor'); } }), 'other');
  assert.equal(asked, 0);
}));

// ---------------------------------------------------------------------------------------------
// gitBehind — a clone's own "up to date". The rules:
// - the first poll answers null at once and measures once; the next poll has the count;
// - a count is kept for a day, and 0 ("up to date") is a count, not a failure;
// - a failed measure is null and is re-asked after an hour;
// - while a job runs (`busy`) nothing is measured, so no fetch races the update's own pull.

test('gitBehind answers null first, then the count, and asks once a day', async () => {
  const st = {};
  let calls = 0;
  const measure = async () => { calls += 1; return 3; };
  assert.equal(gitBehind(st, { measure, now: 0 }), null);
  await settle();
  assert.equal(gitBehind(st, { measure, now: 1 }), 3);
  assert.equal(gitBehind(st, { measure, now: DAY }), 3, 'not re-asked inside the day');
  assert.equal(calls, 1);
  gitBehind(st, { measure, now: DAY + 1 });
  await settle();
  assert.equal(calls, 2, 're-asked once the day is up');
});

test('gitBehind keeps 0 for a day and retries a failure after an hour', async () => {
  const st = {};
  gitBehind(st, { measure: async () => 0, now: 0 });
  await settle();
  assert.equal(gitBehind(st, { measure: async () => 9, now: HOUR + 1 }), 0,
    '0 commits behind is an answer kept for a day, not a failure retried hourly');
  const bad = {};
  let calls = 0;
  const measure = async () => { calls += 1; throw new Error('offline'); };
  gitBehind(bad, { measure, now: 0 });
  await settle();
  assert.equal(gitBehind(bad, { measure, now: HOUR - 1 }), null);
  assert.equal(calls, 1, 'not retried inside the hour');
  gitBehind(bad, { measure, now: HOUR + 1 });
  await settle();
  assert.equal(calls, 2, 'retried once the hour is up');
});

test('gitBehind measures nothing while a job is running', async () => {
  const st = {};
  let calls = 0;
  const measure = async () => { calls += 1; return 1; };
  assert.equal(gitBehind(st, { measure, now: 0, busy: true }), null);
  await settle();
  assert.equal(calls, 0);
  gitBehind(st, { measure, now: 1 });
  await settle();
  assert.equal(calls, 1);
});

// This checkout is a git worktree: `install` is `git`, nothing is fetched under `node --test`
// (so `behind` stays null), and there is no command to run by hand.
test('/api/update on this checkout says git, with no manual command', () => {
  const r = apiUpdate({});
  assert.equal(r.install, 'git');
  assert.equal(r.git, true);
  assert.equal(r.behind, null);
  assert.equal(r.command, null);
});
