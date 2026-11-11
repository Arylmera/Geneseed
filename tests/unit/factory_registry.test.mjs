// tests/unit/factory_registry.test.mjs
//
// `js/factory/registry.mjs` — the run identity list `geneseed factory init` records into, and the
// console reads back through `listFactories`. It shares the loop registry's code (`sweepRows`),
// so these rows prove the factory side of it: its own file, its own key, its own state file. Every
// test points XDG_CONFIG_HOME into the sandbox (restored afterwards) so nothing touches the
// machine tier, and `now` is always passed in, never read off the clock. The last test is the one
// gate on D19's report path: `.geneseed/factory-runs/` is ignored by the `.gitignore` Geneseed
// seeds in `.geneseed/`, as git itself reads it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { makeSandbox } from '../helpers/sandbox.mjs';
import { factoryRegistryPath, recordFactory, listFactories } from '../../js/factory/registry.mjs';
import { registryPath } from '../../js/loop/registry.mjs';
import { initFactory, renderFactoryFile } from '../../js/factory/state.mjs';
import { GENESEED_GITIGNORE } from '../../js/hosts/geneseed-dir.mjs';

const FACTORY = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../fixtures/factories/fixture-fix.json'), 'utf8'));

function withXdg(sb, fn) {
  const saved = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(sb.path, 'xdg');
  try { return fn(); } finally {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved;
  }
}

function runRoot(sb, name) {
  const root = path.join(sb.path, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, 'FACTORY.md'), renderFactoryFile(initFactory({ title: 'T', requirement: 'R', factory: FACTORY })));
  return root;
}

const raw = () => JSON.parse(readFileSync(factoryRegistryPath(), 'utf8'));

test('factories.json sits beside loops.json; recordFactory upserts by root and keeps started', () => {
  const sb = makeSandbox('factreg-');
  try {
    withXdg(sb, () => {
      assert.equal(path.dirname(factoryRegistryPath()), path.dirname(registryPath()));
      assert.equal(path.basename(factoryRegistryPath()), 'factories.json');
      const root = runRoot(sb, 'proj');
      recordFactory({ root, branch: 'loop/factory-a', factory: 'fixture-fix', title: 'First', now: new Date('2026-11-01T00:00:00Z') });
      recordFactory({ root, branch: 'loop/factory-b', factory: 'fixture-fix', title: 'Second', now: new Date('2026-11-02T00:00:00Z') });
      assert.deepEqual(raw(), {
        factories: [{ root, branch: 'loop/factory-b', factory: 'fixture-fix', title: 'Second', started: '2026-11-01T00:00:00.000Z' }],
      });
    });
  } finally { sb.cleanup(); }
});

test('listFactories reads FACTORY.md back into a running row', () => {
  const sb = makeSandbox('factreg-');
  try {
    withXdg(sb, () => {
      const root = runRoot(sb, 'proj');
      recordFactory({ root, branch: 'loop/factory-a', factory: 'fixture-fix', title: 'Run', now: new Date('2026-11-01T00:00:00Z') });
      assert.deepEqual(listFactories({ now: '2026-11-01T00:01:00.000Z' }), [{
        root, branch: 'loop/factory-a', factory: 'fixture-fix', title: 'Run', started: '2026-11-01T00:00:00.000Z',
        status: 'running', stage: 'plan', awaiting: null, reason: null, transitions: 0, counters: {},
        lane: null, tasks: null, history: [],
        // The graph FACTORY.md was started from, whole: the console draws a run from it.
        graph: FACTORY,
        // D7: the board's numbers, `runMetrics` of the state: this run has recorded nothing, and
        // its FACTORY.md carries no `started` (the fixture passes no `now`), so that is unknown.
        metrics: { started: null, stages: [], workMs: 0, waitMs: 0, openWaitMs: null, tokens: null, transitions: 0, entries: [] },
      }]);
    });
  } finally { sb.cleanup(); }
});

// D7: the console's read (`listFactories`) never writes. `recordFactory` is the one sweep: it
// stamps `finishedAt` on a run whose FACTORY.md is gone, drops a vanished root, and drops a
// finished run once its stamp is more than 7 days old (exactly 7 days: kept). A running, an unreadable and a finished
// run (FACTORY.md gone), and a root that no longer exists: the poll lists the first three as
// running, `unreadable` and `finished`, skips the vanished root, and leaves the bytes of
// factories.json as they were, so it stamps no `finishedAt` and drops no row. The sweep it no
// longer does runs in `recordFactory`: the next `factory init` stamps the finished run and drops
// the vanished root.
test('listFactories never writes factories.json; recordFactory sweeps it', () => {
  const sb = makeSandbox('factreg-');
  try {
    withXdg(sb, () => {
      const t0 = new Date('2026-11-01T00:00:00Z');
      const live = runRoot(sb, 'live'); const bad = runRoot(sb, 'bad'); const done = runRoot(sb, 'done'); const gone = runRoot(sb, 'gone');
      for (const root of [live, bad, done, gone]) recordFactory({ root, branch: 'b', factory: 'f', title: 't', now: t0 });
      writeFileSync(path.join(bad, 'FACTORY.md'), '# no state block\n');
      rmSync(path.join(done, 'FACTORY.md'));
      rmSync(gone, { recursive: true });
      const before = readFileSync(factoryRegistryPath());
      const id = (root) => ({ root, branch: 'b', factory: 'f', title: 't', started: '2026-11-01T00:00:00.000Z' });
      const rows = listFactories();
      assert.deepEqual(rows.map((r) => [r.root, r.status]), [[live, 'running'], [bad, 'unreadable'], [done, 'finished']]);
      assert.deepEqual(rows.slice(1), [{ ...id(bad), status: 'unreadable' }, { ...id(done), status: 'finished' }]);
      listFactories();
      assert.deepEqual(readFileSync(factoryRegistryPath()), before, 'the poll changed factories.json');
      const fresh = runRoot(sb, 'fresh');
      recordFactory({ root: fresh, branch: 'b', factory: 'f', title: 't', now: new Date('2026-11-02T00:00:00Z') });
      assert.deepEqual(raw().factories.map((r) => [r.root, r.finishedAt ?? null]),
        [[live, null], [bad, null], [done, '2026-11-02T00:00:00.000Z'], [fresh, null]]);
      const day = 24 * 60 * 60 * 1000;
      recordFactory({ root: fresh, branch: 'b', factory: 'f', title: 't', now: new Date(Date.parse('2026-11-02T00:00:00Z') + 7 * day) });
      assert.equal(raw().factories.length, 4, 'exactly 7 days after the stamp: kept');
      recordFactory({ root: fresh, branch: 'b', factory: 'f', title: 't', now: new Date(Date.parse('2026-11-02T00:00:00Z') + 7 * day + 1) });
      assert.deepEqual(raw().factories.map((r) => r.root), [live, bad, fresh], 'past 7 days: dropped');
    });
  } finally { sb.cleanup(); }
});

test('a corrupt factories.json reads as empty, and neither function throws', () => {
  const sb = makeSandbox('factreg-');
  try {
    withXdg(sb, () => {
      mkdirSync(path.dirname(factoryRegistryPath()), { recursive: true });
      writeFileSync(factoryRegistryPath(), '{ nope');
      assert.deepEqual(listFactories(), []);
      const root = runRoot(sb, 'proj');
      recordFactory({ root, branch: 'b', factory: 'f', title: 't', now: new Date('2026-11-01T00:00:00Z') });
      assert.equal(raw().factories.length, 1);
      assert.ok(!existsSync(registryPath()), 'the loop registry is never written');
    });
  } finally { sb.cleanup(); }
});

// D19: retro writes `.geneseed/factory-runs/<slug>.md`. The seeded `.geneseed/.gitignore` starts
// with `/*` and lets back only the team paths, so git ignores the report; a team file such as
// `bricks/x.md` stays visible, and so does a project factory (D8, `factories/x.json`). Real git
// answers, through `check-ignore` (exit 0: ignored).
test('the seeded .geneseed/.gitignore makes git ignore factory-runs/ and nothing a team shares', () => {
  const sb = makeSandbox('factreg-');
  try {
    const g = (...args) => spawnSync('git', args, { cwd: sb.path, encoding: 'utf8', windowsHide: true });
    assert.equal(g('init', '-q').status, 0);
    mkdirSync(path.join(sb.path, '.geneseed'));
    writeFileSync(path.join(sb.path, '.geneseed', '.gitignore'), GENESEED_GITIGNORE);
    assert.equal(g('check-ignore', '-q', '.geneseed/factory-runs/fix-rounding.md').status, 0);
    assert.equal(g('check-ignore', '-q', '.geneseed/bricks/x.md').status, 1);
    assert.equal(g('check-ignore', '-q', '.geneseed/factories/x.json').status, 1);
  } finally { sb.cleanup(); }
});
