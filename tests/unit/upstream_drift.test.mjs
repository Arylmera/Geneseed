/**
 * Upstream drift gate: `driftReport` flags a key only when a CITED path changed upstream, and
 * the scanner finds both citation forms. `compare` is stubbed: no network.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { makeSandbox } from '../helpers/sandbox.mjs';
import { driftReport, githubCompare, scanCitedPaths, syncIssues } from '../upstream_drift.mjs';

const ups = { sp: { repo: 'o/sp', commit: 'abc' }, dd: { repo: 'o/dd', commit: 'def' } };
const cited = new Map([['sp', new Set(['skills/x/SKILL.md'])], ['dd', new Set()]]);

test('a changed cited path yields one row; an uncited change yields none', async () => {
  const rows = await driftReport({ sp: ups.sp }, cited, async () => ['skills/x/SKILL.md', 'README.md']);
  assert.deepEqual(rows, [{ key: 'sp', changed: ['skills/x/SKILL.md'], url: 'https://github.com/o/sp/compare/abc...HEAD' }]);
  assert.deepEqual(await driftReport({ sp: ups.sp }, cited, async () => ['README.md', 'skills/y/SKILL.md']), []);
});

test('a VENDOR-only key (no path) drifts on any change, and not on none', async () => {
  assert.equal((await driftReport({ dd: ups.dd }, cited, async () => ['anything'])).length, 1);
  assert.deepEqual(await driftReport({ dd: ups.dd }, cited, async () => []), []);
});

test('scanner reads CREDIT tokens and VENDOR.md key lines', () => {
  const sb = makeSandbox('drft-');
  const d = sb.path;
  try {
    fs.mkdirSync(path.join(d, 'v'));
    fs.writeFileSync(path.join(d, 'a.md'), 'x {{CREDIT:sp:skills/x/SKILL.md}} y');
    fs.writeFileSync(path.join(d, 'v/VENDOR.md'), '- **Upstream key:** dd (repo)\n');
    const m = scanCitedPaths(d);
    assert.deepEqual([...m.get('sp')], ['skills/x/SKILL.md']);
    assert.equal(m.get('dd').size, 0);
  } finally { sb.cleanup(); }
});

test('a VENDOR.md Upstream key overrides CREDIT paths: whole-repo, unfiltered', async () => {
  const sb = makeSandbox('drft-');
  const d = sb.path;
  try {
    fs.writeFileSync(path.join(d, 'VENDOR.md'), '{{CREDIT:dd:daydream}}\n- **Upstream key:** dd (repo)\n');
    const m = scanCitedPaths(d);
    assert.equal(m.get('dd').size, 0);
    assert.equal((await driftReport({ dd: ups.dd }, m, async () => ['skills/daydream/SKILL.md'])).length, 1);
  } finally { sb.cleanup(); }
});

test('syncIssues creates, updates and closes by bracketed key, orphans and PRs included', async () => {
  const calls = [];
  const open = [
    { number: 1, title: 'Upstream drift [ms-2]' }, { number: 2, title: 'Upstream drift [ms]' },
    { number: 3, title: 'Upstream drift [gone]' }, { number: 4, title: 'Upstream drift [ms]', pull_request: {} },
  ];
  const call = async (method, url, body) => { calls.push([method, url, body]); return url.includes('/issues?') ? open : {}; };
  const row = (key) => ({ key, changed: ['f'], url: 'u' });
  // `ms` drifts, `ms-2` does not: an unbracketed includes('ms') would update #1 and miss closing it.
  await syncIssues(call, 'o/r', {}, [row('ms'), row('new')]);
  const has = (m, u, pred = () => true) => calls.some(([cm, cu, cb]) => cm === m && cu === u && pred(cb));
  assert.ok(has('PATCH', '/repos/o/r/issues/2', (b) => b.body));                 // ms: update
  assert.ok(has('POST', '/repos/o/r/issues', (b) => b.title.includes('[new]'))); // new: create
  assert.ok(has('PATCH', '/repos/o/r/issues/1', (b) => b.state === 'closed'));   // ms-2: close
  assert.ok(has('PATCH', '/repos/o/r/issues/3', (b) => b.state === 'closed'));   // orphan: close
  assert.ok(!calls.some(([, u]) => u.endsWith('/issues/4')));                    // PR untouched
  assert.ok(has('POST', '/repos/o/r/labels'));
});

test('real compare fails loud when the file list is truncated', async () => {
  const files = Array.from({ length: 300 }, (_, i) => ({ filename: `f${i}` }));
  await assert.rejects(githubCompare(async () => ({ files }))('o/r', 'abc'), /truncated at 300 files/);
  assert.equal((await githubCompare(async () => ({ files: files.slice(1) }))('o/r', 'abc')).length, 299);
});
