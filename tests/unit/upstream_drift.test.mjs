/**
 * Upstream drift gate: `driftReport` flags a key only when a CITED path changed upstream, and
 * the scanner finds both citation forms. `compare` is stubbed: no network.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { creditProblems } from '../../js/inspect/checks-repo.mjs';
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

test('a VENDOR.md Upstream key narrows to its own CREDIT paths, dropping other files citations', () => {
  const sb = makeSandbox('drft-');
  const d = sb.path;
  try {
    fs.writeFileSync(path.join(d, 'VENDOR.md'), '{{CREDIT:dd:skills/dd}}\n- **Upstream key:** dd (repo)\n');
    fs.writeFileSync(path.join(d, 'other.md'), '{{CREDIT:dd:docs/elsewhere.md}}\n');
    assert.deepEqual([...scanCitedPaths(d).get('dd')], ['skills/dd']);
  } finally { sb.cleanup(); }
});

test('a VENDOR.md with an Upstream key but no CREDIT token falls back to the whole repo: any change is one row', async () => {
  const sb = makeSandbox('drft-');
  try {
    fs.writeFileSync(path.join(sb.path, 'VENDOR.md'), '- **Upstream key:** dd (repo)\n');
    assert.equal((await driftReport({ dd: ups.dd }, scanCitedPaths(sb.path), async () => ['README.md'])).length, 1);
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

test('a vendored key is compared only inside its vendored folder and a root licence', async () => {
  const sb = makeSandbox('drft-');
  try {
    fs.writeFileSync(path.join(sb.path, 'VENDOR.md'), '{{CREDIT:dd:skills/dd}}\n- **Upstream key:** dd (repo)\n');
    const m = scanCitedPaths(sb.path);
    const run = (files) => driftReport({ dd: ups.dd }, m, async () => files);
    // Outside skills/dd/ and not the licence: README.md and another skill are not ours, so no row.
    assert.deepEqual(await run(['README.md', 'skills/other/SKILL.md', 'skills/dd-extra/x.md']), []);
    // Inside the folder, or the root LICENSE: one row naming exactly those files.
    assert.deepEqual((await run(['README.md', 'skills/dd/SKILL.md', 'LICENSE']))[0].changed, ['skills/dd/SKILL.md', 'LICENSE']);
  } finally { sb.cleanup(); }
});

test('a frozen key is skipped: no row and no compare call, however much changed', async () => {
  let calls = 0;
  const compare = async () => { calls++; return ['skills/x/SKILL.md']; };
  assert.deepEqual(await driftReport({ sp: { ...ups.sp, frozen: true } }, cited, compare), []);
  assert.equal(calls, 0);
  assert.equal((await driftReport({ sp: ups.sp }, cited, compare)).length, 1); // unfrozen control
});

test('creditProblems still refuses a frozen key with a bad commit or a non-boolean flag', () => {
  const sb = makeSandbox('drft-');
  try {
    fs.mkdirSync(path.join(sb.path, 'skills'));
    fs.mkdirSync(path.join(sb.path, 'licenses'));
    fs.writeFileSync(path.join(sb.path, 'licenses/k.txt'), 'MIT');
    fs.writeFileSync(path.join(sb.path, 'skills/s.md'), '{{CREDIT:k:a.md}}\n');
    const entry = { repo: 'o/r', author: 'a', license: 'MIT', licenseFile: 'licenses/k.txt' };
    const run = (extra) => {
      fs.writeFileSync(path.join(sb.path, 'upstreams.json'), JSON.stringify({ k: { ...entry, ...extra } }));
      return creditProblems(sb.path).join('\n');
    };
    assert.equal(run({ commit: 'a'.repeat(40), frozen: true }), '');
    assert.match(run({ commit: 'main', frozen: true }), /moving branch/);
    assert.match(run({ commit: 'abc', frozen: true }), /not a 40-character/);
    assert.match(run({ commit: 'a'.repeat(40), frozen: 'yes' }), /not a boolean/);
  } finally { sb.cleanup(); }
});
