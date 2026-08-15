// THE WEB API'S FUNCTIONS, IN PROCESS — the successor to `tests/test_web.py`.
//
// WHY THIS TIER EXISTS BESIDE THE 114 WEB CELLS, in `tests/web_golden.py`'s own words: the HTTP
// cells were designed NOT to replace these. A cell is a request script over one reused
// connection, and what it proves is the SHELL — routing, keep-alive, caching, compression,
// status codes, the exact bytes on the wire. It reaches each `apiX` through a transport that
// serialises the answer and throws the objects away. Porting the cells and dropping this file
// would leave the shell proved and the functions unasserted.
//
// THE FIXTURE IS SHARED AND BUILT ONCE — see `tests/helpers/web_fixture.mjs` for why a web test
// that does not build its own install reads whatever the developer happens to have deployed.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { spawnSync } from 'node:child_process';

import { localHost } from '../../js/web/server.mjs';
import {
  NotFound, webState, apiOverview, apiCatalog, apiItem, specDesc, apiDiff,
} from '../../js/web/api.mjs';
import { apiRestore } from '../../js/web/actions.mjs';
import { JobManager, actionCommands } from '../../js/web/jobs.mjs';
import { diffCollect } from '../../js/diff.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';
import { webFixture, webFixtureTeardown, ROOT } from '../helpers/web_fixture.mjs';

const FIXTURE = webFixture();
after(webFixtureTeardown);

// A REAL INSTALL AT A CHOSEN FOOTPRINT, through the shipping driver rather than through an
// internal render call. The reference could say `build.emit_opencode_global(..., cfg=...)`
// because the config dir was a function argument; the port resolves it from the environment,
// which is the same path a user's `geneseed build` takes. `--out` is the source bundle, `cfg`
// is where the install lands.
function emitInto(cfg, { footprint = 'full', theme = 'neutral', out = null } = {}) {
  const proc = spawnSync(process.execPath,
    [path.join(ROOT, 'bin', 'geneseed.mjs'), '--emit', 'opencode-global',
      '--theme', theme, '--footprint', footprint, '--out', out || `${cfg}-bundle`],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, OPENCODE_CONFIG_DIR: cfg } });
  assert.equal(proc.status, 0, `emit into ${cfg} failed:\n${proc.stdout}\n${proc.stderr}`);
  return cfg;
}

// ---------------------------------------------------------------------------------------------
// The DNS-rebinding guard: only loopback Host headers reach the API.

test('loopback hosts pass the local-host guard', () => {
  for (const h of ['127.0.0.1', '127.0.0.1:4747', 'localhost', 'LOCALHOST:80',
    '[::1]:4747', '[::1]']) {
    assert.ok(localHost(h), `${h} was rejected`);
  }
});

// THE SUFFIX CASES ARE THE POINT. `127.0.0.1.evil.com` and `localhost.evil.com` are what a
// naive `startsWith`/`includes` guard lets through, and they are the whole DNS-rebinding attack:
// an attacker's DNS name that resolves to loopback, so the browser sends it and the origin check
// is the only thing standing between a web page and this API.
test('foreign hosts are rejected by the local-host guard', () => {
  for (const h of ['evil.com', 'evil.com:4747', '127.0.0.1.evil.com',
    'localhost.evil.com', '', null, undefined]) {
    assert.ok(!localHost(h), `${JSON.stringify(h)} was accepted`);
  }
});

// ---------------------------------------------------------------------------------------------
// The catalog and the overview.

const neutral = () => webState('neutral');

test('the overview carries counts, a doctor verdict and an accent', () => {
  const ov = apiOverview(neutral());

  assert.ok('counts' in ov);
  assert.equal(typeof ov.counts.agents, 'number');
  assert.ok(ov.counts.agents > 0,
    'zero agents — the shared fixture did not build, and every count assertion in this file '
    + 'is now measuring an empty directory rather than the port');
  assert.equal(typeof ov.counts.config, 'number');

  assert.ok('doctor' in ov);
  assert.ok('ok' in ov.doctor);
  assert.ok(Array.isArray(ov.doctor.problems));
  assert.ok('checked_at' in ov.doctor);

  assert.ok('theme' in ov);
  // The UI tints itself with the deployed theme's accent.
  assert.ok(['red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'].includes(ov.accent),
    `accent ${JSON.stringify(ov.accent)} is not one of the seven`);
});

// A doctor run walks the whole install. Doing it per REQUEST would make every page load pay for
// it, so the verdict is memoised on the state and only `refresh()` drops it.
test('the doctor verdict is cached until refresh', () => {
  const st = neutral();
  const first = apiOverview(st).doctor;
  assert.equal(st.doctor, st.doctor, 'the getter recomputed between two reads');
  const second = apiOverview(st).doctor;
  assert.deepEqual(first, second);

  st.refresh();
  assert.equal(st._doctor, null, 'refresh() left the previous verdict in place');
});

test('a catalog section answers with named, titled, described items', () => {
  const cat = apiCatalog(neutral(), 'agents');
  assert.equal(cat.section, 'agents');
  assert.ok(cat.items.length > 0);
  const first = cat.items[0];
  for (const k of ['name', 'title', 'desc']) assert.ok(k in first, `no ${k} on a catalog row`);
});

test('an unknown catalog section raises NotFound', () => {
  assert.throws(() => apiCatalog(neutral(), 'bogus'), NotFound);
});

// A skill the lifecycle registry never heard of — dropped into the install by hand — must be
// tagged `personal` on BOTH axes. Filing it under the `build` class fallback would claim a
// Geneseed taxonomy slot it was never given.
test('a skill of your own reads personal and keeps out of the taxonomy', () => {
  const mine = path.join(FIXTURE, 'skills', 'my-own-thing');
  fs.mkdirSync(mine, { recursive: true });
  fs.writeFileSync(path.join(mine, 'SKILL.md'), '---\nname: my-own-thing\n---\n\nMine.\n');
  let items;
  try {
    items = apiCatalog(webState('neutral'), 'skills').items;
  } finally {
    fs.rmSync(mine, { recursive: true, force: true });
  }
  const byName = Object.fromEntries(items.map((e) => [e.name, e]));
  assert.equal(byName['my-own-thing'].status, 'personal');
  assert.equal(byName['my-own-thing'].klass, 'personal');
  // A shipped skill next to it is untouched — still classed, still approved. Without this half
  // a classifier that answered `personal` for EVERYTHING would pass the two rows above.
  assert.equal(byName.commit.klass, 'ship');
  assert.equal(byName.commit.status, 'approved');
});

test('an item answers with its body and its links', () => {
  const st = neutral();
  const { name } = apiCatalog(st, 'agents').items[0];
  const item = apiItem(st, 'agent', name);
  assert.equal(item.name, name);
  assert.ok(item.body);
  assert.ok(Array.isArray(item.links));
});

test('a missing item raises NotFound', () => {
  assert.throws(() => apiItem(neutral(), 'agent', 'does-not-exist-xyz'), NotFound);
});

// Agents and skills expose their `src/` file too, so the UI shows the real path instead of
// guessing one — uniform with memory/notebook.
test('an agent carries the same source in the catalog and in the item', () => {
  const st = neutral();
  const row = apiCatalog(st, 'agents').items[0];
  assert.ok(fs.statSync(row.source).isFile(), `${row.source} is not a file`);
  assert.equal(apiItem(st, 'agent', row.name).source, row.source);
});

// The detail pane shows where a document lives on disk, so the file-backed branch (shared by
// memory and notebook) must return the absolute, RESOLVED path to the file it read. Driven
// through notebook because its directory hangs off `state.target` and so is hermetic to control.
test('a file-backed item carries the resolved source path', () => {
  const sb = makeSandbox();
  try {
    const nb = path.join(sb.path, 'notebook');
    fs.mkdirSync(nb);
    fs.writeFileSync(path.join(nb, 'ritual.md'), '# Ritual\n');
    const st = webState('neutral', sb.path);

    const item = apiItem(st, 'notebook', 'ritual');
    assert.equal(item.source, fs.realpathSync.native(path.join(nb, 'ritual.md')));
    // The catalog row carries the same source, so the list and the detail pane agree without
    // the UI having to guess the path.
    assert.equal(apiCatalog(st, 'notebook').items[0].source, item.source);
  } finally { sb.cleanup(); }
});

// GET /api/item NEEDS NO TOKEN, so a separator, a `..`, or a drive colon in the name segment was
// an arbitrary-file read: `config` joined `state.target / name` raw, and memory/notebook resolved
// the `..` through the appended `.md`. Every flat-name type must 404 rather than resolve.
test('an item name may not traverse outside its catalog directory', () => {
  const sb = makeSandbox();
  try {
    fs.mkdirSync(path.join(sb.path, 'notebook'));
    fs.writeFileSync(path.join(sb.path, 'secret.txt'), 's3cret');
    const st = webState('neutral', sb.path);
    for (const type of ['notebook', 'memory', 'config']) {
      for (const name of ['../secret.txt', '..\\secret.txt', 'C:evil', 'a/b', '..']) {
        assert.throws(() => apiItem(st, type, name), NotFound,
          `${type}/${JSON.stringify(name)} resolved instead of 404ing`);
      }
    }
  } finally { sb.cleanup(); }
});

// ---------------------------------------------------------------------------------------------
// Purpose derivation for deployed specs: blockquote first, then the frontmatter description,
// then the first prose paragraph — so vendored skills with no blockquote never show a blank
// Purpose.

// THE FRONTMATTER IS A `Map`, NOT AN OBJECT, and that is not a translation detail: the parser
// returns one so the document's key ORDER survives, which a plain object cannot promise for
// integer-like keys. Every case here passes a Map for the same reason the product does.
const fm = (o) => new Map(Object.entries(o));

test('a blockquote wins the purpose', () => {
  assert.equal(specDesc(fm({ description: 'fm desc' }),
    '# Title\n\n> the curated purpose\n\nMore text.'), 'the curated purpose');
});

test('the purpose falls back to the frontmatter description', () => {
  assert.equal(
    specDesc(fm({ description: 'Guide for view\ntransitions' }),
      '# React View Transitions\n\nAnimate between UI states.'),
    'Guide for view transitions');
});

test('the purpose falls back to the first paragraph', () => {
  assert.equal(specDesc(fm({}),
    '# Vault Daydream Skill\n\nMines the vault\nfor connections.\n\n## Usage'),
    'Mines the vault for connections.');
});

// ---------------------------------------------------------------------------------------------
// Diff, and the footprint regression that is the reason this class is not a cell.

// A harness that was just built must report ZERO local edits, at EVERY footprint. The expected
// copy is rendered from the install's own markers — theme, emit and footprint — and getting any
// of the three wrong invents drift the user cannot clear by rebuilding.
//
// THE REGRESSION: footprint was the one not read. Every lean install therefore reported two
// permanent edits — AGENT.md (the terse §1 digest against the inlined full laws) and
// laws/universal.md, which only the lean global emit writes — from the moment it finished
// building.
for (const footprint of ['lean', 'full']) {
  test(`a freshly emitted ${footprint} install shows no drift`, () => {
    const sb = makeSandbox();
    try {
      const cfg = emitInto(path.join(sb.path, 'cfg'), { footprint });
      assert.equal(fs.readFileSync(path.join(cfg, '.geneseed-footprint'), 'utf8').trim(),
        footprint, 'the emit did not record the footprint it was asked for');

      const { files } = diffCollect({ target: cfg });
      const drift = (files || []).filter((f) => f.status !== 'same');
      assert.deepEqual(drift.map((f) => [f.status, f.rel]), [],
        `a just-built ${footprint} install reports drift`);
    } finally { sb.cleanup(); }
  });
}

// Restore renders its expected copy at the install's OWN footprint. Rendered at `full` on a lean
// install it rewrites AGENT.md with the inlined laws and DELETES laws/universal.md — which only
// the lean emit writes — so "discard my local edit" silently converted the install to full.
test('restore keeps a lean install lean', () => {
  const sb = makeSandbox();
  try {
    const cfg = emitInto(path.join(sb.path, 'cfg'), { footprint: 'lean' });
    const agent = path.join(cfg, 'AGENT.md');
    const leanAgent = fs.readFileSync(agent, 'utf8');
    fs.writeFileSync(agent, `${leanAgent}\nlocal edit\n`);

    const res = apiRestore(webState('neutral', cfg), ['AGENT.md', 'laws/universal.md']);

    assert.deepEqual(res.errors, []);
    assert.deepEqual(res.deleted, [],
      'restore deleted a file the lean emit writes — it rendered at the wrong footprint');
    assert.ok(fs.statSync(path.join(cfg, 'laws', 'universal.md')).isFile());
    assert.equal(fs.readFileSync(agent, 'utf8'), leanAgent,
      'restore did not put the lean AGENT.md back byte for byte');
  } finally { sb.cleanup(); }
});

test('diff against a directory with no install reports not-deployed', () => {
  const sb = makeSandbox();
  try {
    const res = apiDiff(webState('neutral', sb.path));
    assert.equal(res.deployed, false);
    assert.deepEqual(res.files, []);
  } finally { sb.cleanup(); }
});

// ---------------------------------------------------------------------------------------------
// The job manager.
//
// THE CHILDREN ARE `node`, NOT `python`. The reference's jobs spawned `sys.executable`, which is
// the one thing P4 removes from the machine — a ported test that kept it would be a unit test
// that cannot run on the platform this migration is building.
//
// `wait(jid, timeout)` HAS NO PORT, and it did not need one: it was a blocking helper on a class
// whose Node twin runs its steps on the event loop. Polling `get()` is what a caller does here,
// so that is what the test does.
const node = (src) => [process.execPath, '-e', src];

async function waitJob(jm, jid, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const j = jm.get(jid);
    if (j && j.status !== 'running') return j;
    assert.ok(Date.now() < deadline, `job ${jid} never left running: ${JSON.stringify(j)}`);
    await new Promise((r) => { setTimeout(r, 20); });
  }
}

async function until(pred, what, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await new Promise((r) => { setTimeout(r, 20); });
  }
}

test('a job runs to completion and captures its output', async () => {
  const jm = new JobManager();
  const jid = jm.start('noop', [node('console.log("hello")')]);
  assert.notEqual(jid, null);
  const job = await waitJob(jm, jid);
  assert.equal(job.status, 'done');
  assert.match(job.output, /hello/);
  assert.equal(job.returncode, 0);
});

test('a second job while one is running returns null', async () => {
  const jm = new JobManager();
  const jid = jm.start('slow', [node('setTimeout(() => {}, 2000)')]);
  assert.notEqual(jid, null);
  assert.equal(jm.start('other', [node('console.log("x")')]), null, 'the manager was not busy');
  await waitJob(jm, jid);
});

test('history persists and a fresh manager reloads the finished run', async () => {
  const sb = makeSandbox();
  try {
    const hp = path.join(sb.path, 'runs.json');
    const jm = new JobManager(hp);
    const jid = jm.start('noop', [node('console.log("hi")')]);
    await waitJob(jm, jid);
    await until(() => fs.existsSync(hp), 'the history file to be written');

    // A fresh manager — a server restart — reloads the finished run.
    const jobs = new JobManager(hp).recent();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, jid);
    assert.equal(jobs[0].status, 'done');
    assert.notEqual(jobs[0].duration, null);
    assert.match(jobs[0].output, /hi/);
  } finally { sb.cleanup(); }
});

test('recent() is chronological', async () => {
  const jm = new JobManager();
  const a = jm.start('first', [node('console.log(1)')]);
  await waitJob(jm, a);
  const b = jm.start('second', [node('console.log(2)')]);
  await waitJob(jm, b);
  assert.deepEqual(jm.recent().map((j) => j.id), [a, b]);
});

test('cancel terminates a running job', async () => {
  const jm = new JobManager();
  const jid = jm.start('slow', [node('setTimeout(() => {}, 30000)')]);
  await until(() => jm._procs.get(jid), 'the child process to be registered');

  assert.equal(jm.cancel(jid), true);
  const job = await waitJob(jm, jid);
  assert.equal(job.status, 'failed');
  assert.match(job.output, /cancelled by user/);
});

test('cancelling an unknown or finished job returns false', async () => {
  const jm = new JobManager();
  assert.equal(jm.cancel('nope'), false);
  const jid = jm.start('quick', [node('console.log("x")')]);
  await waitJob(jm, jid);
  assert.equal(jm.cancel(jid), false);
});

// `onDone` receives the job's EXIT CODE so callers can react to failure — the update action only
// bounces the daemon when rc === 0.
test('onDone fires after completion with the exit code', async () => {
  const jm = new JobManager();
  const seen = [];
  const jid = jm.start('noop', [node('console.log("x")')], (rc) => seen.push(rc));
  await waitJob(jm, jid);
  await until(() => seen.length, 'onDone to fire');
  assert.deepEqual(seen, [0]);
});

test('onDone gets a non-zero exit code on failure', async () => {
  const jm = new JobManager();
  const seen = [];
  const jid = jm.start('boom', [node('process.exit(3)')], (rc) => seen.push(rc));
  await waitJob(jm, jid);
  await until(() => seen.length, 'onDone to fire');
  assert.deepEqual(seen, [3]);
});

test('a failing job is captured with its stderr and its code', async () => {
  const jm = new JobManager();
  const jid = jm.start('boom', [node('process.stderr.write("bad"); process.exit(3)')]);
  const job = await waitJob(jm, jid);
  assert.equal(job.status, 'failed');
  assert.equal(job.returncode, 3);
  assert.match(job.output, /bad/);
});

// ---------------------------------------------------------------------------------------------
// The action table.

// Build must render the DEPLOYED install in its theme — not a bare, neutral build.
test('the build action preserves theme and emit', () => {
  const cmds = actionCommands('build', { theme: 'imperial', emit: 'opencode-global' });
  assert.equal(cmds.length, 1);
  const argv = cmds[0].map(String);
  assert.ok(argv.includes('--theme') && argv.includes('imperial'));
  assert.ok(argv.includes('--emit') && argv.includes('opencode-global'));
});

test('the update action runs a single upgrade', () => {
  const cmds = actionCommands('update');
  assert.equal(cmds.length, 1);
  assert.ok(cmds[0].map(String).includes('upgrade'));
  assert.ok(!cmds[0].map(String).join(' ').includes('sync-self'));
});

test('an unknown action is null', () => {
  assert.equal(actionCommands('bogus'), null);
});
