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
import os from 'node:os';
import path from 'node:path';

import { spawnSync } from 'node:child_process';

import { localHost } from '../../js/web/server.mjs';
import {
  NotFound, webState, apiOverview, apiCatalog, apiItem, specDesc, apiDiff,
  apiThemes, apiDoctor,
} from '../../js/web/api.mjs';
import {
  apiRestore, apiMcp, apiMcpToggle, buildOverride,
} from '../../js/web/actions.mjs';
import { MCP_PRESETS } from '../../js/mcp.mjs';
import { JobManager, actionCommands } from '../../js/web/jobs.mjs';
import { diffCollect } from '../../js/diff.mjs';
import { makeSandbox, TMP_ROOT } from '../helpers/sandbox.mjs';
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

// ---------------------------------------------------------------------------------------------
// The theme picker.

test('the theme list carries themes, emits and the current pair', () => {
  const t = apiThemes(neutral());
  const names = t.themes.map((x) => x.name);
  assert.ok(names.includes('neutral'));
  assert.ok(names.includes('imperial'));
  assert.ok(t.emits.map((x) => x.name).includes('opencode-global'));
  assert.equal(t.current.theme, 'neutral');
});

test('a valid build override wins over the state', () => {
  const [theme, emit] = buildOverride(neutral(), { theme: 'imperial', emit: 'files' });
  assert.equal(theme, 'imperial');
  assert.equal(emit, 'files');
});

test('an invalid build override falls back to the state', () => {
  const st = neutral();
  st.emit = 'opencode-global';
  const [theme, emit] = buildOverride(st, { theme: 'bogus', emit: 'nope' });
  assert.equal(theme, 'neutral');
  assert.equal(emit, 'opencode-global');
});

test('an empty build override body uses the state', () => {
  const st = neutral();
  const [theme, emit] = buildOverride(st, {});
  assert.equal(theme, st.theme);
  assert.equal(emit, st.emit);
});

test('every theme choice carries its gallery fields and a known accent', () => {
  const t = apiThemes(neutral());
  const n = t.themes.find((x) => x.name === 'neutral');
  for (const key of ['blurb', 'accent', 'tagline', 'sigil']) assert.ok(key in n, `no ${key}`);
  assert.equal(n.accent, 'cyan');
  // Every theme declares an accent the swatch palette knows — a theme with an unknown accent
  // renders untinted, which looks like a CSS bug rather than a data one.
  for (const x of t.themes) {
    assert.ok(['red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'].includes(x.accent),
      `theme ${x.name} declares accent ${JSON.stringify(x.accent)}`);
  }
});

// ---------------------------------------------------------------------------------------------
// Doctor: the grouped view and the flat list are the same set.

test('the doctor groups are exactly the flat problem list', () => {
  const d = apiDoctor(neutral());
  assert.ok('groups' in d);
  assert.ok(d.groups.length > 0);
  for (const g of d.groups) {
    assert.ok('check' in g);
    assert.ok('label' in g);
    assert.ok(Array.isArray(g.problems));
  }
  const checks = new Set(d.groups.map((g) => g.check));
  for (const need of ['build', 'global', 'parity', 'authoring']) {
    assert.ok(checks.has(need), `no ${need} group`);
  }
  // The flat list is exactly the union of the groups, deduped and sorted. Two renderings of
  // one verdict that can disagree is a console that reports a different number of problems
  // depending on which panel you look at.
  const union = [...new Set(d.groups.flatMap((g) => g.problems))].sort();
  assert.deepEqual(d.problems, union);
  assert.equal(d.ok, d.problems.length === 0);
});

// ---------------------------------------------------------------------------------------------
// Restore.

test('restore rewrites an edit, deletes an addition and rejects bad paths', () => {
  const sb = makeSandbox();
  try {
    const cfg = emitInto(path.join(sb.path, 'cfg'));
    const st = webState('neutral', cfg);
    const agent = path.join(cfg, 'AGENT.md');
    const original = fs.readFileSync(agent, 'utf8');
    fs.writeFileSync(agent, `${original}\nLOCAL EDIT\n`);
    const extra = path.join(cfg, 'zz-extra.md');
    fs.writeFileSync(extra, 'local only\n');

    const res = apiRestore(st, ['AGENT.md', 'zz-extra.md', 'bogus.md', '../escape.md']);

    assert.ok(res.restored.includes('AGENT.md'), 'the edited file was not restored');
    assert.equal(fs.readFileSync(agent, 'utf8'), original);
    assert.ok(res.deleted.includes('zz-extra.md'), 'the added file was not deleted');
    assert.ok(!fs.existsSync(extra));
    assert.equal(res.errors.length, 2, 'the unknown name and the traversal must both error');
  } finally { sb.cleanup(); }
});

test('restore without a deployed install is an error', () => {
  const sb = makeSandbox();
  try {
    const res = apiRestore(webState('neutral', sb.path), ['AGENT.md']);
    assert.deepEqual(res.restored, []);
    assert.deepEqual(res.errors, ['no deployed harness']);
  } finally { sb.cleanup(); }
});

// ---------------------------------------------------------------------------------------------
// The wiki.

function wikiFixture() {
  const sb = makeSandbox();
  const vault = path.join(sb.path, 'vault');
  fs.mkdirSync(path.join(vault, 'sub'), { recursive: true });
  fs.mkdirSync(path.join(vault, 'Hidden'));
  fs.writeFileSync(path.join(vault, 'Note.md'), '# Note\nSee [[learn]].');
  fs.writeFileSync(path.join(vault, 'sub', 'Page.md'), '# Page');
  fs.writeFileSync(path.join(vault, 'Hidden', 'Secret.md'), '# Secret');
  const manifest = path.join(sb.path, 'wiki.jsonc');
  fs.writeFileSync(manifest, JSON.stringify({
    wikis: [{
      name: 'test',
      path: vault,
      entries: [
        { path: 'Note.md', load: 'eager', description: 'the note' },
        { path: 'sub/', load: 'lazy' },
        { path: 'Hidden/', load: 'exclude' },
      ],
    }],
  }));
  const saved = process.env.GENESEED_WIKI;
  process.env.GENESEED_WIKI = manifest;
  return {
    sb,
    root: sb.path,
    done() {
      if (saved === undefined) delete process.env.GENESEED_WIKI;
      else process.env.GENESEED_WIKI = saved;
      sb.cleanup();
    },
  };
}

test('the wiki catalog lists pages minus the excluded folder', () => {
  const w = wikiFixture();
  try {
    const names = apiCatalog(webState('neutral'), 'wiki').items.map((i) => i.name);
    assert.ok(names.includes('test:Note.md'));
    assert.ok(names.includes('test:sub/Page.md'));
    assert.ok(!names.includes('test:Hidden/Secret.md'),
      'an `exclude` entry was listed — the manifest is advisory rather than enforced');
  } finally { w.done(); }
});

test('a wiki item reads its page and blocks traversal and unknown vaults', () => {
  const w = wikiFixture();
  try {
    const st = webState('neutral');
    const item = apiItem(st, 'wiki', 'test:Note.md');
    assert.match(item.body, /# Note/);
    assert.equal(item.title, 'Note');
    assert.throws(() => apiItem(st, 'wiki', 'test:../wiki.jsonc'), NotFound);
    assert.throws(() => apiItem(st, 'wiki', 'nope:Note.md'), NotFound);
  } finally { w.done(); }
});

// The console groups the Knowledge list by vault and routes each row by its own type, so pages
// must be tagged with both.
test('wiki pages carry their group and their type', () => {
  const w = wikiFixture();
  try {
    const rows = apiCatalog(webState('neutral'), 'wiki').items;
    const row = rows.find((i) => i.name === 'test:Note.md');
    assert.equal(row.type, 'wiki');
    assert.equal(row.kind, 'page');
    assert.equal(row.group, 'test');
  } finally { w.done(); }
});

// The setup files render as parsed manifests — cards plus an entries table — not a raw JSON
// dump, so `apiItem` must hand back a structured `manifest`.
test('a config item returns the parsed manifest', () => {
  const w = wikiFixture();
  try {
    fs.writeFileSync(path.join(w.root, 'context.json'), JSON.stringify({
      context: [{ path: 'README.md', load: 'eager', description: 'x' }],
    }));
    const st = webState(null, w.root);

    const ctx = apiItem(st, 'config', 'context.json');
    assert.equal(ctx.title, 'Project context');
    assert.equal(ctx.manifest.kind, 'context');
    assert.equal(ctx.manifest.context[0].load, 'eager');

    const wk = apiItem(st, 'config', 'wiki.jsonc');
    assert.equal(wk.manifest.kind, 'wiki');
    assert.equal(wk.manifest.wikis[0].name, 'test');

    // Both surface as Setup manifests in the catalog.
    const rows = Object.fromEntries(apiCatalog(st, 'config').items.map((i) => [i.name, i]));
    assert.equal(rows['context.json'].kind, 'manifest');
    assert.equal(rows['wiki.jsonc'].title, 'Wiki manifest');
  } finally { w.done(); }
});

// ---------------------------------------------------------------------------------------------
// MCP.
//
// THE TARGETS ARE REAL, NOT FAKED, and this is the one place the port is stronger than the
// reference by necessity. `tests/test_web.py` replaced `_mcp_install_targets` with a lambda —
// a module-level rebind ESM does not allow, since `apiMcpToggle` closes over the imported
// binding. The alternative is not a weaker test: `installTargets()` scans `process.cwd()` for
// each host's project marker, so creating `.opencode/` or `.claude/` in a sandbox and chdiring
// into it produces a target the product DISCOVERS. The allowlist is then exercised as shipped
// rather than as substituted — and the Python's fake could not have caught a discovery bug at
// all, because it replaced discovery.
//
// CHDIR IS PROCESS-WIDE, so every one of these restores it in a `finally`. Note what that
// protects against: this repository's own root carries a `.claude/` directory, so a toggle test
// that ran from there would have `<repo>/.mcp.json` in its allowlist and could write into the
// working tree.
function inProjectDir(marker, fn) {
  const sb = makeSandbox();
  const cwd = process.cwd();
  try {
    fs.mkdirSync(path.join(sb.path, marker), { recursive: true });
    process.chdir(sb.path);
    // The sandbox root is canonical, but `process.cwd()` is what `installTargets` reads and it
    // must agree with the path this test hands the allowlist.
    return fn(process.cwd());
  } finally {
    process.chdir(cwd);
    sb.cleanup();
  }
}

test('the MCP listing carries every active install with its servers', () => {
  // The shared fixture IS an active opencode-global install, which is what makes this
  // structural check hold on any machine: the reference had to fake one for the same reason
  // and got a weaker assertion for it.
  const m = apiMcp();
  assert.ok(m.targets.length > 0, 'no active install was listed — the fixture is not active');
  for (const t of m.targets) {
    assert.ok('path' in t);
    assert.ok('commented' in t);
    assert.ok(['opencode', 'claude', 'bob', 'copilot'].includes(t.host));
    assert.ok('root' in t);
    for (const s of t.servers) {
      assert.ok(['enabled', 'disabled', 'absent'].includes(s.state));
      assert.ok('label' in s);
    }
  }
  assert.equal(typeof m.default, 'number');
});

test('an OpenCode target adds a preset and then disables it in place', () => {
  inProjectDir('.opencode', (root) => {
    const cfgPath = path.join(root, 'opencode.json');
    const st = neutral();
    const preset = Object.keys(MCP_PRESETS)[0];

    let res = apiMcpToggle(st, { path: cfgPath, name: preset, enabled: true });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.state, 'enabled');

    // OpenCode KEEPS the entry and flips its enabled flag, so the state becomes `disabled`.
    res = apiMcpToggle(st, { path: cfgPath, name: preset, enabled: false });
    assert.equal(res.ok, true);
    assert.equal(res.state, 'disabled');

    assert.throws(() => apiMcpToggle(st, { path: 'bogus', name: preset, enabled: true }),
      NotFound, 'an unlisted path was accepted — the allowlist is the whole security here');
  });
});

test('a Claude target adds under mcpServers and REMOVES on toggle off', () => {
  inProjectDir('.claude', (root) => {
    const cfgPath = path.join(root, '.mcp.json');
    const st = neutral();

    let res = apiMcpToggle(st, { path: cfgPath, name: 'markitdown', enabled: true });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.state, 'enabled');
    let cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    assert.deepEqual(cfg.mcpServers.markitdown, { command: 'uvx', args: ['markitdown-mcp'] });
    assert.ok(!('mcp' in cfg), "OpenCode's key was written into a Claude config");

    // Claude has no enabled flag, so toggling off REMOVES the entry.
    res = apiMcpToggle(st, { path: cfgPath, name: 'markitdown', enabled: false });
    assert.equal(res.ok, true);
    assert.equal(res.state, 'absent');
    cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    assert.ok(!Object.hasOwn(cfg.mcpServers || {}, 'markitdown'));
  });
});

// `~/.claude.json` is the USER-scope config and it holds far more than MCP wiring — projects,
// history, startup counts. It is always a discovered target, so no marker directory is needed.
//
// THE GUARD BELOW IS NOT DECORATION. These two tests WRITE and then DELETE `~/.claude.json`,
// and the only thing standing between that and the developer's real 160 kB Claude config is
// `os.homedir()` reading the sandbox's `USERPROFILE`/`HOME`. It does — but "it does" is an
// observation about today's Node, and the failure mode is silent destruction of a file this
// suite does not own. `tests/unit/sandbox.test.mjs` already carries the rule this follows:
// assert on the ENVIRONMENT, never by observing the leak.
function sandboxHomeFile(name) {
  const home = os.homedir();
  assert.ok(home.startsWith(TMP_ROOT),
    `os.homedir() is ${home}, which is not under the test temp root — refusing to write and `
    + `delete ${name} in the developer's real home`);
  return path.join(home, name);
}

test('a Claude config keeps its unrelated keys and refuses to be clobbered', () => {
  const cfgPath = sandboxHomeFile('.claude.json');
  const st = neutral();
  try {
    fs.writeFileSync(cfgPath, JSON.stringify({ numStartups: 7, projects: { '/x': {} } }));
    const res = apiMcpToggle(st, { path: cfgPath, name: 'gitlab', enabled: true });
    assert.equal(res.ok, true, JSON.stringify(res));
    const after = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    assert.equal(after.numStartups, 7, 'an unrelated key was dropped');
    assert.ok('gitlab' in after.mcpServers);

    // A config that will not parse is REFUSED, never clobbered.
    fs.writeFileSync(cfgPath, '{ not json');
    const bad = apiMcpToggle(st, { path: cfgPath, name: 'markitdown', enabled: true });
    assert.equal(bad.ok, false);
    assert.equal(fs.readFileSync(cfgPath, 'utf8'), '{ not json',
      'an unparseable config was overwritten — this file holds the user\'s whole Claude state');
  } finally {
    fs.rmSync(cfgPath, { force: true });
  }
});

// A Claude config is STRICT JSON and must round-trip byte-faithfully. A string value holding
// `,]` or `, }` — realistic in `~/.claude.json`'s history and prompts — must NOT have its comma
// silently dropped by the OpenCode comment-stripper's trailing-comma pass. This is the
// regression guard for a parser-mismatch DATA-LOSS bug.
test('a Claude config does not have its string values mangled', () => {
  const cfgPath = sandboxHomeFile('.claude.json');
  const st = neutral();
  const booby = {
    history: [{ display: 'jq .a[] | select(.x,]' }, { display: 'rewrite {a, } please' }],
    note: 'fix [1,2,] and {b, }',
  };
  try {
    fs.writeFileSync(cfgPath, JSON.stringify(booby));
    const res = apiMcpToggle(st, { path: cfgPath, name: 'markitdown', enabled: true });
    assert.equal(res.ok, true, JSON.stringify(res));
    const after = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    assert.deepEqual(after.history, booby.history, 'a comma was dropped from a string value');
    assert.equal(after.note, booby.note);
    assert.ok('markitdown' in after.mcpServers);
  } finally {
    fs.rmSync(cfgPath, { force: true });
  }
});
