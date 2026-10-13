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

import { semverGreater, updateStatus } from '../../js/web/update-check.mjs';

const HOUR = 60 * 60 * 1000;
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
  assert.equal(calls, 1, 'a poll during the fetch must not start a second one');
  await settle();
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
  assert.equal(calls, 2, 'retried once the hour is up');
});
