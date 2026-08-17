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

import http from 'node:http';

import { localHost, makeHandler, buildPlan } from '../../js/web/server.mjs';
import {
  NotFound, webState, apiOverview, apiCatalog, apiItem, specDesc, apiDiff,
  apiThemes, apiDoctor, apiInstalls, apiExcludes, apiSetup, viewCfg,
} from '../../js/web/api.mjs';
import { apiGraph } from '../../js/web/graph.mjs';
import {
  apiActivity, apiActivityDetail, apiActivityToggle,
} from '../../js/web/activity.mjs';
import {
  apiDocs, apiDocsPage, docGroups, normHarness, stripHarnessBlocks, harnessBlocksBalanced,
} from '../../js/web/docs.mjs';
import {
  apiRestore, apiMcp, apiMcpToggle, buildOverride, apiInstallToggle,
  apiInstallCmd, apiSelectView, apiExcludesMutate, apiDeployCmd, globalEmitHostFor,
  apiRules, apiRulesMutate, apiRulesPromote, RULES_FILE,
} from '../../js/web/actions.mjs';
import { installState, themeOfDir, installTargets } from '../../js/installs.mjs';
import { installDeactivate, installReactivate, installUninstall } from '../../js/uninstall.mjs';
import { registryRecord, registryRoots } from '../../js/registry.mjs';
import { parseOrigin, originDisplay } from '../../js/update.mjs';
import { MCP_PRESETS as _P, mcpConfigFor, mcpState, mcpSetEnabled } from '../../js/mcp.mjs';
import { MCP_PRESETS } from '../../js/mcp.mjs';
import { GLOBAL_MANIFEST, VERSION_MARKER, pyResolve } from '../../js/hosts.mjs';
import { normcase } from '../../js/lib/pyfs.mjs';
import { JobManager, actionCommands } from '../../js/web/jobs.mjs';
import { diffCollect } from '../../js/diff.mjs';
import { makeSandbox, TMP_ROOT, RELOCATION_VARS } from '../helpers/sandbox.mjs';
import { webFixture, webFixtureTeardown, ROOT } from '../helpers/web_fixture.mjs';
import { withGlobalInstalls as withGlobalInstallsFixture } from '../helpers/installs_fixture.mjs';

// `js/web/api.mjs` keeps its own `samePath` module-private. Rebuilt here from the same two
// primitives rather than exported from the product for a test's benefit — and it must be
// `normcase(pyResolve(...))` on both sides, because on Windows the two spellings this
// comparison exists to reconcile differ in CASE as well as in shape.
const samePath = (a, b) => normcase(pyResolve(a)) === normcase(pyResolve(b));

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

// ---------------------------------------------------------------------------------------------
// The Harness-installs switch.
//
// Deactivate MOVES owned artifacts into a sibling `.geneseed-disabled/` stash and strips the
// AGENT.md `instructions` entry — never deleting a file — and reactivate restores the exact
// prior bytes. The on-disk stash dir alone is the state; there is no recorded JSON flag.
//
// THE INSTALL IS DISCOVERED, NOT INJECTED — the same argument as the MCP block above. The
// reference pinned `_install_targets` to a single seeded root; `installTargets()` resolves an
// OpenCode global from `$OPENCODE_CONFIG_DIR`, so pointing that at the seeded root produces the
// target through the product's own resolver.
//
// ONE ASSERTION HAD TO CHANGE SHAPE, and it is worth naming rather than quietly dropping. The
// reference asserted `len(installs) == 1`, which was a property of its FAKE: real discovery also
// yields a global row for claude, bob and copilot, all `absent`. The property under test is
// about the ROW — its keys, its host, its scope, its path, its state — so the port selects the
// row by path and asserts on it. The count assertion measured the monkeypatch, not the code.
const DISABLED = '.geneseed-disabled';
const asPosix = (p) => p.split(path.sep).join('/');

function withGlobalRoot(fn) {
  const sb = makeSandbox();
  const saved = process.env.OPENCODE_CONFIG_DIR;
  const root = path.join(sb.path, 'opencode');
  fs.mkdirSync(root, { recursive: true });
  process.env.OPENCODE_CONFIG_DIR = root;
  try {
    return fn({ root, tmp: sb.path });
  } finally {
    if (saved === undefined) delete process.env.OPENCODE_CONFIG_DIR;
    else process.env.OPENCODE_CONFIG_DIR = saved;
    sb.cleanup();
  }
}

const agentEntry = (root) => `${asPosix(root)}/AGENT.md`;

// A minimal GLOBAL install: AGENT.md + agents/x.md + a manifest listing them (plus
// VERSION_MARKER, the one marker the real manifest carries) + an opencode.json whose
// `instructions` already points at AGENT.md.
function seedGlobal(root, opencodeText = null) {
  fs.writeFileSync(path.join(root, 'AGENT.md'), '# Rules\nbody\n');
  fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(root, 'agents', 'x.md'), '# agent x\n');
  // VERSION_MARKER is the only marker that appears in `owned`; deactivate must leave it in
  // place, so theme and version detection keep working while the install is disabled.
  fs.writeFileSync(path.join(root, VERSION_MARKER), 'v\n');
  fs.writeFileSync(path.join(root, GLOBAL_MANIFEST), JSON.stringify({
    owned: ['AGENT.md', 'agents/x.md', VERSION_MARKER].sort(),
  }));
  fs.writeFileSync(path.join(root, 'opencode.json'),
    opencodeText ?? JSON.stringify({ instructions: [agentEntry(root)], lsp: true }));
}

const instructionsOf = (root) => (JSON.parse(
  fs.readFileSync(path.join(root, 'opencode.json'), 'utf8')).instructions || []);

const rowFor = (state, root) => {
  const rows = apiInstalls(state).installs;
  const row = rows.find((r) => samePath(r.path, root));
  assert.ok(row, `no install row for ${root}; discovery returned `
    + `${JSON.stringify(rows.map((r) => [r.host, r.scope, r.path]))}`);
  return row;
};

test('an install row carries its identity and its state per scope', () => {
  withGlobalRoot(({ root, tmp }) => {
    seedGlobal(root);
    const row = rowFor(neutral(), root);
    for (const key of ['id', 'host', 'scope', 'path', 'state']) assert.ok(key in row, `no ${key}`);
    assert.equal(row.host, 'opencode');
    assert.equal(row.scope, 'global');
    assert.equal(row.state, 'active', 'manifest present and no stash must read active');

    // `absent`: a root with neither a manifest nor a marker dir.
    const empty = path.join(tmp, 'empty');
    fs.mkdirSync(empty);
    process.env.OPENCODE_CONFIG_DIR = empty;
    assert.equal(rowFor(neutral(), empty).state, 'absent');
  });
});

test('deactivate then reactivate restores the exact bytes', () => {
  withGlobalRoot(({ root }) => {
    seedGlobal(root);
    const stash = path.join(root, DISABLED);
    const agentBytes = fs.readFileSync(path.join(root, 'AGENT.md'));
    const xBytes = fs.readFileSync(path.join(root, 'agents', 'x.md'));
    const st = neutral();

    let res = apiInstallToggle(st, { host: 'opencode', path: root, action: 'deactivate' });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.kind, 'global');
    assert.equal(res.moved, 2, 'AGENT.md + agents/x.md');

    // The artifacts live under the stash at their ORIGINAL rel paths...
    assert.ok(fs.statSync(stash).isDirectory());
    assert.ok(fs.statSync(path.join(stash, 'AGENT.md')).isFile());
    assert.ok(fs.statSync(path.join(stash, 'agents', 'x.md')).isFile());
    // ...and NO file was deleted — the bytes are preserved in the stash.
    assert.deepEqual(fs.readFileSync(path.join(stash, 'AGENT.md')), agentBytes);
    assert.deepEqual(fs.readFileSync(path.join(stash, 'agents', 'x.md')), xBytes);
    // The live copies are gone from the discovery path...
    assert.ok(!fs.existsSync(path.join(root, 'AGENT.md')));
    assert.ok(!fs.existsSync(path.join(root, 'agents', 'x.md')));
    // ...and the emptied owned dir is pruned by uninstall's ancestor climb.
    assert.ok(!fs.existsSync(path.join(root, 'agents')));
    // The AGENT.md instructions entry is stripped.
    assert.ok(!instructionsOf(root).includes(agentEntry(root)));
    // VERSION_MARKER stays put — markers are excluded from the move.
    assert.ok(fs.statSync(path.join(root, VERSION_MARKER)).isFile());
    assert.ok(!fs.existsSync(path.join(stash, VERSION_MARKER)));
    // The stash dir IS the flag.
    assert.equal(rowFor(neutral(), root).state, 'disabled');

    res = apiInstallToggle(st, { host: 'opencode', path: root, action: 'activate' });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.deepEqual(fs.readFileSync(path.join(root, 'AGENT.md')), agentBytes);
    assert.deepEqual(fs.readFileSync(path.join(root, 'agents', 'x.md')), xBytes);
    assert.ok(instructionsOf(root).includes(agentEntry(root)), 'the entry was not restored');
    assert.ok(!fs.existsSync(stash), 'the stash survived a complete restore');
    assert.equal(rowFor(neutral(), root).state, 'active');
  });
});

// Plant a plain FILE named like the stash dir. `installState` gates on `isDir(root/DISABLED)`,
// so a file leaves the state `active` and the operation is allowed to START — but every
// `mkdir(stash/rel)` then fails, forcing a mid-operation failure and a full roll-back.
test('deactivate rolls back on a failed move', () => {
  withGlobalRoot(({ root }) => {
    seedGlobal(root);
    const stash = path.join(root, DISABLED);
    const agentBytes = fs.readFileSync(path.join(root, 'AGENT.md'));
    const xBytes = fs.readFileSync(path.join(root, 'agents', 'x.md'));
    fs.writeFileSync(stash, 'not a dir\n');

    const res = apiInstallToggle(neutral(),
      { host: 'opencode', path: root, action: 'deactivate' });
    assert.equal(res.ok, false);
    assert.ok('failed' in res);
    assert.ok(res.failed.length > 0);

    // Everything is back where it started — no half-gutted install.
    assert.deepEqual(fs.readFileSync(path.join(root, 'AGENT.md')), agentBytes);
    assert.deepEqual(fs.readFileSync(path.join(root, 'agents', 'x.md')), xBytes);
    // The config edit is the LAST step, so a move failure leaves it intact.
    assert.ok(instructionsOf(root).includes(agentEntry(root)));
    // Still ACTIVE — the blocking file is not a stash dir.
    assert.equal(rowFor(neutral(), root).state, 'active');
    // The blocking artifact is untouched: the engine deleted nothing.
    assert.equal(fs.readFileSync(stash, 'utf8'), 'not a dir\n');
  });
});

test('reactivate discards a stale stash when the files were re-created', () => {
  withGlobalRoot(({ root }) => {
    seedGlobal(root);
    const stash = path.join(root, DISABLED);
    const st = neutral();

    let res = apiInstallToggle(st, { host: 'opencode', path: root, action: 'deactivate' });
    assert.equal(res.ok, true);
    assert.ok(fs.statSync(stash).isDirectory());

    // `geneseed build` re-creating the live install while it is disabled: the manifest,
    // AGENT.md and agents/ are all back on the discovery path.
    seedGlobal(root);
    assert.ok(fs.statSync(path.join(root, 'AGENT.md')).isFile());

    res = apiInstallToggle(st, { host: 'opencode', path: root, action: 'activate' });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.ok('note' in res);
    assert.match(res.note, /discarded/);
    // The stale stash goes, the live files are untouched...
    assert.ok(!fs.existsSync(stash));
    assert.ok(fs.statSync(path.join(root, 'AGENT.md')).isFile());
    // ...and the instructions entry is ensured present.
    assert.ok(instructionsOf(root).includes(agentEntry(root)));
    assert.equal(rowFor(neutral(), root).state, 'active');
  });
});

// OpenCode prefers a present `opencode.jsonc`; a commented one must not be rewritten, because
// that would drop the comments — so deactivate aborts up front.
test('deactivate refuses a commented jsonc and moves nothing', () => {
  withGlobalRoot(({ root }) => {
    seedGlobal(root);
    fs.rmSync(path.join(root, 'opencode.json'));
    fs.writeFileSync(path.join(root, 'opencode.jsonc'),
      `// my notes\n{\n  "instructions": ["${agentEntry(root)}"]\n}\n`);

    const res = apiInstallToggle(neutral(),
      { host: 'opencode', path: root, action: 'deactivate' });
    assert.equal(res.ok, false);
    assert.ok('error' in res);
    // Nothing moved: live files in place, no stash created, comments intact.
    assert.ok(fs.statSync(path.join(root, 'AGENT.md')).isFile());
    assert.ok(fs.statSync(path.join(root, 'agents', 'x.md')).isFile());
    assert.ok(!fs.existsSync(path.join(root, DISABLED)));
    assert.match(fs.readFileSync(path.join(root, 'opencode.jsonc'), 'utf8'), /\/\/ my notes/);
    assert.equal(rowFor(neutral(), root).state, 'active');
  });
});

test('the install toggle rejects an unknown path', () => {
  withGlobalRoot(({ root }) => {
    seedGlobal(root);
    assert.throws(() => apiInstallToggle(neutral(),
      { path: '/no/such/root', action: 'deactivate' }), NotFound);
  });
});

test('an unknown install action is not ok', () => {
  withGlobalRoot(({ root }) => {
    seedGlobal(root);
    const res = apiInstallToggle(neutral(),
      { host: 'opencode', path: root, action: 'bogus' });
    assert.equal(res.ok, false);
  });
});

// ---------------------------------------------------------------------------------------------
// Install creation: `apiInstallCmd` resolves the build command for an install or a re-theme,
// keyed on the (host, path) allowlist. It installs an absent row, rebuilds an active one,
// refuses a disabled one and 404s an unknown pair.
//
// ALL THREE STATES ARE BUILT, NOT DECLARED. The reference faked both `_install_targets` and
// `_install_state`, which meant the states under test were the test's own opinion of what
// `absent`/`active`/`disabled` look like. Here each one is produced the way the product decides
// it — a manifest for `active`, a `.geneseed-disabled/` DIRECTORY for `disabled`, nothing at all
// for `absent` — so a change to `installState`'s rules reddens this instead of sailing past a
// lookup table.
function withThreeInstalls(fn) {
  const sb = makeSandbox();
  const cwd = process.cwd();
  const savedOc = process.env.OPENCODE_CONFIG_DIR;
  try {
    // active: an OpenCode global carrying a manifest.
    const oc = path.join(sb.path, 'oc');
    fs.mkdirSync(oc, { recursive: true });
    fs.writeFileSync(path.join(oc, GLOBAL_MANIFEST), JSON.stringify({ owned: [] }));
    process.env.OPENCODE_CONFIG_DIR = oc;

    // disabled: an OpenCode PROJECT — `.opencode/` makes it a project install, and the stash
    // DIRECTORY is what `installState` reads as disabled.
    const proj = path.join(sb.path, 'proj');
    fs.mkdirSync(path.join(proj, '.opencode'), { recursive: true });
    fs.mkdirSync(path.join(proj, DISABLED), { recursive: true });
    process.chdir(proj);

    // absent: `~/.claude` under the sandboxed home, which nothing has created.
    const cl = path.join(os.homedir(), '.claude');
    assert.ok(!fs.existsSync(path.join(cl, GLOBAL_MANIFEST)),
      `${cl} already carries a manifest — the absent case is not absent and this test is `
      + 'measuring something else');

    const st = neutral();
    assert.equal(installState(oc, 'opencode', 'global'), 'active');
    assert.equal(installState(process.cwd(), 'opencode', 'project'), 'disabled');
    assert.equal(installState(cl, 'claude', 'global'), 'absent');
    return fn({ st, oc, cl, proj: process.cwd() });
  } finally {
    process.chdir(cwd);
    if (savedOc === undefined) delete process.env.OPENCODE_CONFIG_DIR;
    else process.env.OPENCODE_CONFIG_DIR = savedOc;
    sb.cleanup();
  }
}

test('the install command for an absent global target', () => {
  withThreeInstalls(({ st, cl }) => {
    const plan = apiInstallCmd(st, { host: 'claude', path: cl });
    assert.ok('cmd' in plan, JSON.stringify(plan));
    const cmd = plan.cmd.map(String);
    assert.ok(cmd.includes('claude-global'));
    assert.ok(cmd.includes('neutral'), 'a new install must inherit the current voice');
    assert.ok(!cmd.includes('--out'), 'a global install takes no out/root');
  });
});

test('the install command honours a valid picked theme', () => {
  withThreeInstalls(({ st, cl }) => {
    const plan = apiInstallCmd(st, { host: 'claude', path: cl, theme: 'imperial' });
    assert.ok(plan.cmd.map(String).includes('imperial'));
  });
});

// The theme comes out of a request body and lands in an argv, so a bogus one must never reach
// the command line — it falls back to the state's theme instead.
test('the install command rejects a bogus theme and falls back', () => {
  withThreeInstalls(({ st, cl }) => {
    const plan = apiInstallCmd(st, { host: 'claude', path: cl, theme: '../evil' });
    const cmd = plan.cmd.map(String);
    assert.ok(!cmd.includes('../evil'), 'a path-shaped theme reached the argv');
    assert.ok(cmd.includes('neutral'));
  });
});

test('an active install rebuilds in place with the same build command', () => {
  withThreeInstalls(({ st, oc }) => {
    const plan = apiInstallCmd(st, { host: 'opencode', path: oc, theme: 'imperial' });
    assert.ok('cmd' in plan, JSON.stringify(plan));
    const cmd = plan.cmd.map(String);
    assert.ok(cmd.includes('opencode-global'));
    assert.ok(cmd.includes('imperial'));
  });
});

test('a disabled install is refused rather than rebuilt', () => {
  withThreeInstalls(({ st, proj }) => {
    const plan = apiInstallCmd(st, { host: 'opencode', path: proj });
    assert.ok('error' in plan, JSON.stringify(plan));
    assert.match(plan.error, /disabled/);
  });
});

test('an unknown (host, path) pair raises NotFound', () => {
  withThreeInstalls(({ st }) => {
    assert.throws(() => apiInstallCmd(st, { host: 'claude', path: '/no/such/root' }), NotFound);
  });
});

// ---------------------------------------------------------------------------------------------
// The harness selector: `apiSelectView` re-points the whole console at a detected install
// (target, theme, emit) and `apiInstalls` marks the current one selected.

function withTwoViews(fn) {
  const sb = makeSandbox();
  const savedOc = process.env.OPENCODE_CONFIG_DIR;
  try {
    const oc = path.join(sb.path, 'oc');
    fs.mkdirSync(oc, { recursive: true });
    process.env.OPENCODE_CONFIG_DIR = oc;

    // The claude view, with its OWN markers — the point of the test is that selecting it reads
    // those rather than keeping the opencode view's.
    const cl = path.join(os.homedir(), '.claude');
    fs.mkdirSync(cl, { recursive: true });
    fs.writeFileSync(path.join(cl, '.geneseed-emit'), 'claude-global');
    fs.writeFileSync(path.join(cl, '.geneseed-theme'), 'imperial');

    return fn({ st: webState('neutral', oc), oc, cl });
  } finally {
    fs.rmSync(path.join(os.homedir(), '.claude'), { recursive: true, force: true });
    if (savedOc === undefined) delete process.env.OPENCODE_CONFIG_DIR;
    else process.env.OPENCODE_CONFIG_DIR = savedOc;
    sb.cleanup();
  }
}

test('selecting a view re-points target, theme and emit', () => {
  withTwoViews(({ st, cl }) => {
    const res = apiSelectView(st, { host: 'claude', path: cl });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.ok(samePath(st.target, cl));
    assert.equal(st.theme, 'imperial', "the theme was not read from the selected install");
    assert.equal(st.emit, 'claude-global', 'the emit was not read from the selected install');
  });
});

test('selecting an unknown pair raises NotFound', () => {
  withTwoViews(({ st }) => {
    assert.throws(() => apiSelectView(st, { host: 'claude', path: '/no/such/root' }), NotFound);
  });
});

test('the install list marks exactly the current view selected', () => {
  withTwoViews(({ st, cl }) => {
    let selected = apiInstalls(st).installs.filter((r) => r.selected);
    assert.equal(selected.length, 1, 'more than one row claimed to be the current view');
    assert.equal(selected[0].host, 'opencode', 'the state starts pointed at the opencode view');

    apiSelectView(st, { host: 'claude', path: cl });
    selected = apiInstalls(st).installs.filter((r) => r.selected);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].host, 'claude');
  });
});

// ---------------------------------------------------------------------------------------------
// GET/POST /api/excludes — the web mirror of `harness exclude add|remove|list`. The endpoint
// owns NO exclusion logic of its own; it reuses the snapshot/add/remove trio verbatim, so the
// round trip is exercising the WIRING rather than re-testing the exclusion engine.

// The fixture moved to `tests/helpers/installs_fixture.mjs` when `tests/unit/excludes_guard.test.mjs`
// needed the same one — a fixture with one caller is a fixture the next defect cannot reach.
// This wrapper only adds the `webState` the endpoints take.
const withGlobalInstalls = (hosts, fn) =>
  withGlobalInstallsFixture(hosts, ({ tmp }) => fn({ st: neutral(), tmp }));

test('the excludes endpoint round-trips an add and a remove', () => {
  withGlobalInstalls(['claude', 'bob'], ({ st, tmp }) => {
    const repo = path.join(tmp, 'vault');
    fs.mkdirSync(repo);

    assert.equal(apiExcludesMutate(st, { action: 'add', path: repo }).ok, true);
    const snap = apiExcludes(st);
    assert.equal(snap.excludes.length, 1);
    // MIRROR THE PRODUCT'S CANONICALISATION rather than the path that was handed in: the add
    // stores the RESOLVED path with separators normalised to `/`, and on a Windows runner that
    // expands the 8.3 short temp name. Comparing against the raw argument passes on this
    // laptop and fails on CI, which is the defect this comment exists to prevent.
    assert.equal(snap.excludes[0].path.replace(/\/+$/, ''), asPosix(pyResolve(repo)));

    assert.equal(apiExcludesMutate(st, { action: 'remove', path: repo }).ok, true);
    assert.deepEqual(apiExcludes(st).excludes, []);
  });
});

test('the excludes endpoint rejects a malformed body', () => {
  const st = neutral();
  for (const body of [{}, { action: 'add' }, { path: '/x' },
    { action: 'bogus', path: '/x' }, null]) {
    assert.equal(apiExcludesMutate(st, body).ok, false,
      `${JSON.stringify(body)} was accepted`);
  }
});

// Never excluded, so the remove finds nothing: `ok` false, never a crash.
test('removing an exclude that was never added is not ok', () => {
  withGlobalInstalls(['claude', 'bob'], ({ st, tmp }) => {
    const res = apiExcludesMutate(st,
      { action: 'remove', path: path.join(tmp, 'never-excluded') });
    assert.equal(res.ok, false);
  });
});

// ---------------------------------------------------------------------------------------------
// The citation graph.

test('graph nodes are unique and every edge resolves', () => {
  const g = apiGraph(neutral());
  assert.ok(g.nodes.length > 0);
  const ids = new Set(g.nodes.map((n) => n.id));
  assert.equal(ids.size, g.nodes.length, 'two nodes share an id');
  for (const n of g.nodes) assert.ok(['agent', 'skill', 'law'].includes(n.type), n.type);
  assert.ok(g.nodes.some((n) => n.type === 'law'), 'no law reached the graph');

  // Agents and skills cite EACH OTHER through Markdown cross-links, not only laws — otherwise
  // the only citation targets are laws and the matrix collapses to a single law column.
  const typeOf = Object.fromEntries(g.nodes.map((n) => [n.id, n.type]));
  assert.ok(g.edges.some((e) => typeOf[e.target] !== 'law'),
    'every edge targets a law — the graph has collapsed to one column');

  for (const e of g.edges) {
    assert.ok(ids.has(e.source), `dangling source ${e.source}`);
    assert.ok(ids.has(e.target), `dangling target ${e.target}`);
    assert.notEqual(e.source, e.target, 'a node cites itself');
  }
  const pairs = g.edges.map((e) => `${e.source} ${e.target}`);
  assert.equal(pairs.length, new Set(pairs).size, 'duplicate edges');
});

// THE LAW-NOUN IS THEMED — `{{LAW}}` becomes "Dictate", "Code", "Directive" — so a hardcoded
// `Rule|Law` reference regex found ZERO law edges under any non-neutral theme and the graph
// rendered with no links at all. The console reads the DEPLOYED harness, so each theme is
// emitted to its own target and graphed from there; every theme must yield the same non-empty
// edge set.
test('graph edges survive a themed law noun', () => {
  const sb = makeSandbox();
  try {
    const graphFor = (theme) => {
      const cfg = emitInto(path.join(sb.path, `cfg-${theme}`), { theme });
      return apiGraph(webState(null, cfg));       // theme auto-detected from the install
    };
    const baseline = graphFor('neutral').edges.length;
    assert.ok(baseline > 0, 'the neutral install produced no edges at all');

    for (const theme of ['imperial', 'biker', 'military']) {
      const g = graphFor(theme);
      assert.equal(g.edges.length, baseline, `theme ${theme} dropped edges`);
      const laws = new Set(g.nodes.filter((n) => n.type === 'law').map((n) => n.id));
      assert.ok(g.edges.some((e) => laws.has(e.target)), `theme ${theme} found no law edges`);
    }
  } finally { sb.cleanup(); }
});

// ---------------------------------------------------------------------------------------------
// The setup snapshot.

test('the setup endpoint reports the install snapshot', () => {
  const s = apiSetup(neutral());
  for (const key of ['theme', 'accent', 'emit', 'source_fp', 'installed_fp', 'version_verdict',
    'root', 'target', 'deployed', 'memory_dir', 'facts']) {
    assert.ok(key in s, `no ${key} in the setup snapshot`);
  }
  assert.ok(s.root);
  assert.equal(typeof s.deployed, 'boolean');

  // THE ONE ASSERTION THAT INVERTS, AND IT IS ABOUT A KEY THAT MUST NOT EXIST. The server this
  // one replaced reported the version of the interpreter hosting it, under a key named for that
  // interpreter. There is nothing here that answers the same question, and answering it with
  // this runtime's version under that name would be a lie the About page prints — so the field
  // is gone rather than present-and-null. Asserted rather than dropped: a deleted field that
  // silently grows back is exactly what this gate exists to catch, and `in` is the strong form —
  // `s.python === undefined` would also pass for a key explicitly set to `undefined`.
  assert.ok(!('python' in s),
    'the setup snapshot has grown an interpreter-version key back — there is no interpreter '
    + 'to report and nothing can honestly fill it');
});

// ---------------------------------------------------------------------------------------------
// The handler, over a real socket. The 114 web cells own the shell in depth; these two are the
// wiring check that the dispatcher is reachable at all and that the CSRF gate is on.

async function serve(fn) {
  const jm = new JobManager();
  const handler = makeHandler(neutral(), jm, 'test-token', path.join(ROOT, 'web', 'dist'));
  const srv = http.createServer(handler);
  await new Promise((r) => { srv.listen(0, '127.0.0.1', r); });
  try {
    return await fn(srv.address().port);
  } finally {
    await new Promise((r) => { srv.close(r); });
  }
}

const fetchStatus = (port, urlPath, init = {}) =>
  fetch(`http://127.0.0.1:${port}${urlPath}`, init);

test('the overview endpoint answers over HTTP', async () => {
  await serve(async (port) => {
    const res = await fetchStatus(port, '/api/overview');
    assert.equal(res.status, 200);
    assert.ok('counts' in await res.json());
  });
});

// A POST with no token is 403. The token is the only thing between a page in the user's browser
// and every mutating endpoint on this daemon.
test('a POST without the token is 403', async () => {
  await serve(async (port) => {
    const res = await fetchStatus(port, '/api/actions/doctor', { method: 'POST', body: '{}' });
    assert.equal(res.status, 403);
  });
});

// ---------------------------------------------------------------------------------------------
// `buildPlan` decides what `serve()` does about a missing `web/dist`.

function planFixture({ dist = false, source = false } = {}) {
  const sb = makeSandbox();
  const webDir = path.join(sb.path, 'web');
  const distDir = path.join(webDir, 'dist');
  if (source) {
    fs.mkdirSync(webDir, { recursive: true });
    fs.writeFileSync(path.join(webDir, 'package.json'), '{}');
  }
  if (dist) {
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.html'), '<html></html>');
  }
  return { sb, webDir, distDir };
}

const PLANS = [
  ['serve', { dist: true, source: true }, 'npm', true],
  ['no-source', {}, 'npm', true],
  ['no-npm', { source: true }, null, true],
  ['no-tty', { source: true }, 'npm', false],
  ['ask', { source: true }, 'npm', true],
];

for (const [expected, populate, npm, interactive] of PLANS) {
  test(`buildPlan answers ${expected}`, () => {
    const f = planFixture(populate);
    try {
      assert.equal(buildPlan(f.distDir, f.webDir, npm, interactive), expected);
    } finally { f.sb.cleanup(); }
  });
}

// ---------------------------------------------------------------------------------------------
// The Docs Claude/OpenCode selector: page and group tags drop from the menu, inline
// `<!--harness:X-->` blocks strip per host, and malformed markers FAIL OPEN.

test('the harness name defaults and validates', () => {
  const st = neutral();
  assert.equal(normHarness('claude', st), 'claude');
  assert.equal(normHarness('opencode', st), 'opencode');
  // Junk and null fall back to the install's own default rather than throwing.
  assert.ok(['opencode', 'claude'].includes(normHarness('nonsense', st)));
  assert.ok(['opencode', 'claude'].includes(normHarness(null, st)));
});

test('a harness block keeps the matching host and drops the other', () => {
  const body = 'shared\n'
    + '<!--harness:opencode-->\nopen only\n<!--/harness-->\n'
    + '<!--harness:claude-->\nclaude only\n<!--/harness-->\ntail';
  const oc = stripHarnessBlocks(body, 'opencode');
  const cc = stripHarnessBlocks(body, 'claude');

  assert.match(oc, /open only/);
  assert.ok(!oc.includes('claude only'));
  assert.match(cc, /claude only/);
  assert.ok(!cc.includes('open only'));
  // The markers themselves never survive.
  for (const out of [oc, cc]) {
    assert.ok(!out.includes('<!--harness'));
    assert.ok(!out.includes('<!--/harness'));
  }
});

test('a body with no markers passes through, and a dangling marker fails open', () => {
  assert.equal(stripHarnessBlocks('plain text', 'claude'), 'plain text');
  // An unbalanced marker must NOT blank the tail. Failing closed here would delete the rest
  // of a page over one typo.
  const broken = 'keep me\n<!--harness:claude-->\nand this too';
  assert.equal(stripHarnessBlocks(broken, 'opencode'), broken);
});

// The early-out guard must catch any marker the open regex accepts — odd whitespace included —
// or a stray-spaced marker leaks through unstripped, taking its contents with it.
test('the strip guard is not narrower than its matcher', () => {
  const out = stripHarnessBlocks('A\n<!--  harness:claude  -->\nSECRET\n<!--/harness-->\nB',
    'opencode');
  assert.ok(!out.includes('SECRET'));
  assert.ok(!out.includes('<!--'));
});

// A marker shown as EXAMPLE TEXT inside a fence is not a marker. It must survive verbatim for
// both hosts, fences intact.
test('markers inside a code fence are left alone', () => {
  const body = 'intro\n```\n<!--harness:opencode-->\nexample\n<!--/harness-->\n```\nouter';
  for (const hn of ['opencode', 'claude']) {
    const out = stripHarnessBlocks(body, hn);
    assert.ok(out.includes('<!--harness:opencode-->'), hn);
    assert.match(out, /example/);
    assert.equal((out.match(/```/g) || []).length, 2, hn);
  }
});

test('host-specific pages and groups appear only under their host', () => {
  const idsFor = (hn) => new Set(apiDocs(neutral(), hn).groups.flatMap((g) => g.pages.map((p) => p.id)));
  const oc = idsFor('opencode');
  const cc = idsFor('claude');
  assert.ok(oc.has('adapters-opencode'));
  assert.ok(!cc.has('adapters-opencode'));
  assert.ok(cc.has('mcp-claude-code'));
  assert.ok(!oc.has('mcp-claude-code'));
  // The whole Plugins GROUP is opencode-only — a group tag, not a page tag.
  const claudeGroups = new Set(apiDocs(neutral(), 'claude').groups.map((g) => g.id));
  assert.ok(!claudeGroups.has('plugins'));
});

test('the docs endpoint echoes the resolved harness', () => {
  assert.equal(apiDocs(neutral(), 'claude').harness, 'claude');
  assert.equal(apiDocs(neutral(), 'opencode').harness, 'opencode');
});

test('a docs page strips for its host', () => {
  const st = neutral();
  // `mcp-verify` slices SETUP.md; the opencode clause must vanish under claude.
  const oc = apiDocsPage(st, 'mcp-verify', 'opencode').body;
  const cc = apiDocsPage(st, 'mcp-verify', 'claude').body;
  assert.match(oc, /opencode mcp/);
  assert.ok(!cc.includes('opencode mcp'));
  assert.ok(!(oc + cc).includes('<!--harness'));
});

// FAILING OPEN IS WHY THIS CANNOT BE A RENDERING CHECK. An unbalanced marker leaves the body
// untouched — which is exactly what a correct page with no markers does — so the mistake is
// invisible in the output and only the predicate can see it. Catch it here rather than as a
// blank panel, or as a page that quietly shows the other host's text.
test('every doc source and concept body has balanced harness markers', () => {
  let checked = 0;
  for (const g of docGroups()) {
    for (const p of g.pages) {
      let where;
      let text;
      if (p.kind === 'concept') { where = `concept:${p.id}`; text = p.body || ''; } else if (p.kind === 'markdown') {
        where = p.source;
        text = fs.readFileSync(path.join(ROOT, p.source), 'utf8');
      } else continue;
      checked += 1;
      assert.ok(harnessBlocksBalanced(text.split('\n')),
        `unbalanced harness markers in ${where}`);
    }
  }
  assert.ok(checked > 0, 'no doc source was checked — the registry walk found nothing');
});

// The registry lives in `docs/web/` — a `_groups.json` plus one `.md` per page — not in a
// source literal. A group that loses its pages, or a page whose frontmatter stops naming a real
// group, silently VANISHES from the panel. Pin the shape rather than trust the glob.
test('the docs registry loads every page from disk', () => {
  const groups = docGroups();
  assert.ok(groups.length > 0, 'docs registry loaded empty');
  const ids = groups.flatMap((g) => g.pages.map((p) => p.id));
  assert.equal(ids.length, new Set(ids).size, 'duplicate doc page id');

  const onDisk = fs.readdirSync(path.join(ROOT, 'docs', 'web'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3));
  assert.deepEqual([...ids].sort(), [...onDisk].sort(),
    'every docs/web/*.md must land in exactly one group');

  for (const g of groups) {
    assert.ok(g.pages.length > 0, `group ${g.id} has no pages`);
    assert.ok(g.label, `group ${g.id} has no label`);
  }
});

// Concept bodies carry `{N_LAWS}`/`{N_AGENTS}`/`{N_SKILLS}`, substituted at render time. Moving
// the bodies out of source must not orphan that step: an unsubstituted placeholder renders as
// literal braces on the page.
test('no unsubstituted count placeholder survives rendering', () => {
  const st = neutral();
  for (const g of docGroups()) {
    for (const p of g.pages) {
      if (p.kind !== 'concept') continue;
      assert.ok(!(apiDocsPage(st, p.id, null).body || '').includes('{N_'),
        `page ${p.id} rendered an unsubstituted placeholder`);
    }
  }
});

// Anti-drift, and the reason it exists: "six plugins" went stale when activity landed. A new
// adapters/opencode/plugins/geneseed-<name>.js must ship its own docs page, a bullet on the
// plugins overview, and a mention in the README and SHIPPED.md rows.
test('every plugin ships a docs page, an overview bullet and its README/SHIPPED rows', () => {
  const st = neutral();
  const pluginDir = path.join(ROOT, 'adapters', 'opencode', 'plugins');
  const names = fs.readdirSync(pluginDir)
    .filter((f) => f.startsWith('geneseed-') && f.endsWith('.js'))
    .map((f) => f.slice('geneseed-'.length, -'.js'.length))
    .sort();
  assert.ok(names.length > 0, 'no plugins found — wrong directory?');

  const pageIds = new Set(docGroups().flatMap((g) => g.pages.map((p) => p.id)));
  const overview = apiDocsPage(st, 'plugins', 'opencode').body;
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const shipped = fs.readFileSync(path.join(ROOT, 'SHIPPED.md'), 'utf8');
  const row = /plugins \(([^)]*)\)/.exec(shipped);
  assert.ok(row, 'SHIPPED.md lost its plugins (…) list');
  const shippedNames = new Set(row[1].split(',').map((s) => s.trim()));

  for (const name of names) {
    assert.ok(pageIds.has(`plugin-${name}`), `geneseed-${name}.js has no docs page`);
    assert.ok(overview.includes(`geneseed-${name}`),
      `geneseed-${name} missing from the overview list`);
    assert.ok(readme.includes(`geneseed-${name}`),
      `geneseed-${name} missing from the README plugins row`);
    assert.ok(shippedNames.has(name), `'${name}' missing from the SHIPPED.md plugins list`);
  }
  assert.deepEqual([...shippedNames].sort(), names,
    'SHIPPED.md plugins list is out of sync with adapters/opencode/plugins/');
});

// Counts in concept prose are `{N_*}` placeholders resolved from the SAME inventory the rail
// uses — never hardcoded numbers.
test('concept counts are substituted live from the inventory', () => {
  const st = neutral();
  const inv = st.inventory;
  for (const hn of ['opencode', 'claude']) {
    for (const g of apiDocs(st, hn).groups) {
      for (const p of g.pages) {
        const body = apiDocsPage(st, p.id, hn).body || '';
        assert.ok(!body.includes('{N_'), `${hn}/${p.id} leaked a placeholder`);
      }
    }
  }
  assert.match(apiDocsPage(st, 'skills', 'opencode').body,
    new RegExp(String(inv.skills.length)));
  assert.match(apiDocsPage(st, 'rules', 'opencode').body,
    new RegExp(String(inv.laws.length)));
});

// Every `#/docs/<id>` link in a VISIBLE page must resolve to a page visible under the SAME
// harness — no link dead-ends after filtering.
test('no cross-harness dead links', () => {
  const st = neutral();
  for (const hn of ['opencode', 'claude']) {
    const menu = apiDocs(st, hn);
    const visible = new Set(menu.groups.flatMap((g) => g.pages.map((p) => p.id)));
    for (const g of menu.groups) {
      for (const p of g.pages) {
        const body = apiDocsPage(st, p.id, hn).body || '';
        for (const target of new Set([...body.matchAll(/#\/docs\/([a-z0-9-]+)/g)]
          .map((m) => m[1]))) {
          assert.ok(visible.has(target),
            `${hn}: page '${p.id}' links to '${target}', which is hidden under ${hn}`);
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------------------------
// The live-activity reader: globs `<target>/activity/*.json`, prunes dead and stale writers
// (self-cleaning their files), and never raises on a missing directory or a garbage file.

function activityBox() {
  const sb = makeSandbox();
  return {
    sb,
    state: webState('neutral', sb.path),
    write(name, entry) {
      const d = path.join(sb.path, 'activity');
      fs.mkdirSync(d, { recursive: true });
      const p = path.join(d, name);
      fs.writeFileSync(p, JSON.stringify(entry));
      return p;
    },
  };
}

// `time.time()` is SECONDS. `Date.now()` is milliseconds, and handing the reader a millisecond
// stamp makes every entry look 55 years in the future — which passes the staleness check by
// accident and would make the prune test below vacuous rather than red.
const nowSec = () => Date.now() / 1000;

const withActivity = (fn) => {
  const box = activityBox();
  try { return fn(box); } finally { box.sb.cleanup(); }
};

test('a missing activity dir reads empty and enabled', () => {
  withActivity(({ state }) => {
    const res = apiActivity(state);
    assert.deepEqual(res.activity, []);
    assert.equal(res.enabled, true);
  });
});

test('a live entry is globbed', () => {
  withActivity((box) => {
    box.write('ses_a.json', {
      session_id: 'ses_a', agent: 'reviewer', title: 'fix it', cwd: '/repo',
      status: 'busy', pid: process.pid, updated_at: nowSec(),
    });
    const acts = apiActivity(box.state).activity;
    assert.equal(acts.length, 1);
    assert.equal(acts[0].agent, 'reviewer');
    assert.equal(acts[0].status, 'busy');
  });
});

// A pid that is virtually never alive. The file is REMOVED, not just filtered: a dead writer
// that leaves its snapshot behind would haunt the console forever.
test('a dead pid is pruned and its file self-cleans', () => {
  withActivity((box) => {
    const p = box.write('ses_dead.json', {
      session_id: 'ses_dead', status: 'busy', pid: 2147483647, updated_at: nowSec(),
    });
    assert.deepEqual(apiActivity(box.state).activity, []);
    assert.ok(!fs.existsSync(p), 'the stale file was filtered but not removed');
  });
});

test('a stale entry is pruned even with a live pid', () => {
  withActivity((box) => {
    box.write('ses_old.json', {
      session_id: 'ses_old', status: 'idle', pid: process.pid, updated_at: nowSec() - 10000,
    });
    assert.deepEqual(apiActivity(box.state).activity, []);
  });
});

test('a garbage file never raises', () => {
  withActivity((box) => {
    const d = path.join(box.sb.path, 'activity');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'broken.json'), '{ not json');
    assert.deepEqual(apiActivity(box.state).activity, []);
  });
});

test('the v1.1 fields pass through', () => {
  withActivity((box) => {
    box.write('s.json', {
      session_id: 's', status: 'busy', pid: process.pid, updated_at: nowSec(),
      model: 'opus', phase: 'Editing x', cost: 0.62, tokens: 48000,
      files: { count: 2, additions: 10, deletions: 1, items: [] },
      todos: { done: 1, total: 3, items: [] },
      error: 'oops', blocked_on: null, turn_started_at: nowSec(),
    });
    const e = apiActivity(box.state).activity[0];
    assert.equal(e.model, 'opus');
    assert.equal(e.phase, 'Editing x');
    assert.equal(e.error, 'oops');

    // A PARSED NUMBER IS A `PyNumber`, NOT A JS NUMBER, and that is the port working rather
    // than leaking. `parseJson` keeps each number's SOURCE SPELLING so a read-modify-write
    // round-trips `1.0` as `1.0` instead of collapsing it to `1` — the exact distinction
    // `tests/mutate.mjs`'s M6 is about. The reader hands the parsed object through, so the
    // wrapper reaches the caller and `jsonDumps` unwraps it on the way out.
    assert.equal(Number(e.cost), 0.62);
    assert.equal(Number(e.tokens), 48000);
    assert.equal(Number(e.files.count), 2);
    assert.equal(Number(e.todos.done), 1);
  });
});

// A pre-v1.1 writer omits the new keys and the reader must fill SAFE defaults — `null` for the
// structured ones, `0` for the numeric ones, because the console arithmetics them.
test('a v1 file gets safe defaults', () => {
  withActivity((box) => {
    box.write('s.json', {
      session_id: 's', status: 'idle', pid: process.pid, updated_at: nowSec(),
    });
    const e = apiActivity(box.state).activity[0];
    assert.equal(e.model, null);
    assert.equal(e.phase, null);
    assert.equal(e.files, null);
    // THE DEFAULTS ARE RAW JS NUMBERS where a parsed field is a `PyNumber` — the reader
    // SUPPLIES these rather than reading them, so nothing was parsed to keep a spelling of.
    // Asserted strictly on purpose: it is the one place in this file where the difference
    // between "read from the file" and "filled in by the reader" is observable.
    assert.equal(e.cost, 0);
    assert.equal(e.tokens, 0);
  });
});

test('activity is enabled by default', () => {
  withActivity(({ state }) => assert.equal(apiActivity(state).enabled, true));
});

test('the activity toggle persists and gates the output', () => {
  withActivity((box) => {
    box.write('ses_a.json', {
      session_id: 'ses_a', status: 'busy', pid: process.pid, updated_at: nowSec(),
    });
    assert.equal(apiActivity(box.state).activity.length, 1);

    assert.deepEqual(apiActivityToggle(box.state, { enabled: false }),
      { ok: true, enabled: false });
    assert.ok(fs.statSync(path.join(box.sb.path, '.geneseed-activity')).isFile());

    // Disabled: the output is gated to [] and the flag reads off. The FILES are left for the
    // plugin to clear on its next event rather than deleted here.
    const out = apiActivity(box.state);
    assert.equal(out.enabled, false);
    assert.deepEqual(out.activity, []);

    apiActivityToggle(box.state, { enabled: true });
    assert.equal(apiActivity(box.state).enabled, true);
    assert.equal(apiActivity(box.state).activity.length, 1);
  });
});

// `*.detail.json` is the v1.2 timeline sidecar, not a session snapshot.
test('the activity list skips detail files', () => {
  withActivity((box) => {
    box.write('s.json',
      { session_id: 's', status: 'busy', pid: process.pid, updated_at: nowSec() });
    box.write('s.detail.json', { timeline: [{ kind: 'tool' }], files: null, todos: null });
    assert.deepEqual(apiActivity(box.state).activity.map((a) => a.session_id), ['s']);
  });
});

test('the detail endpoint returns the session and its timeline', () => {
  withActivity((box) => {
    box.write('s.json', {
      session_id: 's', status: 'busy', pid: process.pid, updated_at: nowSec(),
      files: { count: 1, items: [{ file: 'a' }] },
    });
    box.write('s.detail.json', {
      timeline: [{ kind: 'tool', label: 'Editing a.js' }],
      files: { count: 9,
        items: Array.from({ length: 20 }, (_, i) => ({ file: `f${i}.js`, additions: 1, deletions: 0 })) },
      todos: { done: 1, total: 2, items: [{ content: 'a', status: 'completed' }] },
    });
    const res = apiActivityDetail(box.state, 's');
    assert.equal(res.session.session_id, 's');
    assert.equal(res.timeline[0].label, 'Editing a.js');
    // The detail file's UNCAPPED lists win over the snapshot's capped ones — the snapshot caps
    // for the rail, the detail pane wants everything.
    assert.equal(res.session.files.items.length, 20);
    assert.equal(Number(res.session.todos.total), 2);   // a parsed number — see above
  });
});

test('the detail endpoint 404s on an unknown session', () => {
  withActivity(({ state }) => {
    assert.throws(() => apiActivityDetail(state, 'nope'), NotFound);
  });
});

test('the detail endpoint tolerates a missing detail file', () => {
  withActivity((box) => {
    box.write('s.json',
      { session_id: 's', status: 'idle', pid: process.pid, updated_at: nowSec() });
    const res = apiActivityDetail(box.state, 's');
    assert.deepEqual(res.timeline, []);
    assert.equal(res.session.session_id, 's');
  });
});

test('the detail conversation falls back to the session title', () => {
  withActivity((box) => {
    box.write('s.json', {
      session_id: 's', title: 'the very first ask', status: 'busy',
      pid: process.pid, updated_at: nowSec(),
    });
    // No detail file: a single opening user turn synthesised from the session title.
    assert.deepEqual(apiActivityDetail(box.state, 's').conversation,
      [{ role: 'user', text: 'the very first ask' }]);

    // With a captured transcript it is returned as-is, in order.
    const turns = [
      { role: 'user', text: 'add a toggle' },
      { role: 'assistant', text: 'done' },
      { role: 'user', text: 'make it 50/50' },
    ];
    box.write('s.detail.json', { timeline: [], conversation: turns });
    assert.deepEqual(apiActivityDetail(box.state, 's').conversation, turns);
  });
});

// ---------------------------------------------------------------------------------------------
// Deploy: a fresh per-repo harness into a user-chosen folder, persisted in the installs list
// through the registry — the open-ended sibling of the row Install.

// A project emit for any host, through the shipping driver. `--out` and `--root` are the same
// directory for a per-repo layer, which is what the deploy command itself builds.
function emitProject(dir, emitName, theme = 'neutral') {
  const proc = spawnSync(process.execPath,
    [path.join(ROOT, 'bin', 'geneseed.mjs'), '--emit', emitName,
      '--theme', theme, '--out', dir, '--root', dir],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true, env: process.env });
  assert.equal(proc.status, 0, `emit ${emitName} into ${dir} failed:\n${proc.stdout}\n${proc.stderr}`);
  return dir;
}

const after$ = (cmd, flag) => cmd.map(String)[cmd.map(String).indexOf(flag) + 1];

test('the deploy command validates its host and its path', () => {
  const st = neutral();
  assert.match(apiDeployCmd(st, { host: 'nope', path: '/tmp' }).error, /unknown host/);
  assert.match(apiDeployCmd(st, { host: 'opencode', path: '  ' }).error, /no folder/);
  assert.match(apiDeployCmd(st, { host: 'opencode', path: '/no/such/dir/zzz' }).error,
    /not a folder/);

  const sb = makeSandbox();
  try {
    const plan = apiDeployCmd(st, { host: 'opencode', path: sb.path, theme: 'imperial' });
    const cmd = plan.cmd.map(String);
    assert.equal(after$(cmd, '--emit'), 'opencode', 'a deploy is a PROJECT emit, never global');
    assert.equal(after$(cmd, '--theme'), 'imperial');
    assert.equal(after$(cmd, '--out'), pyResolve(sb.path));
    assert.equal(after$(cmd, '--root'), pyResolve(sb.path));
  } finally { sb.cleanup(); }
});

test('a bogus deploy theme falls back to the state theme', () => {
  const sb = makeSandbox();
  try {
    const cmd = apiDeployCmd(neutral(),
      { host: 'claude', path: sb.path, theme: 'not-a-theme' }).cmd.map(String);
    assert.equal(after$(cmd, '--theme'), 'neutral');
    assert.equal(after$(cmd, '--emit'), 'claude');
  } finally { sb.cleanup(); }
});

// Deploying INTO a host's own global config dir would make a project install that shadows the
// global one at the same path. Refused by name.
test('the deploy command refuses a host config dir', () => {
  const sb = makeSandbox();
  const saved = process.env.OPENCODE_CONFIG_DIR;
  try {
    process.env.OPENCODE_CONFIG_DIR = sb.path;
    const res = apiDeployCmd(neutral(), { host: 'opencode', path: sb.path });
    assert.match(res.error || '', /global config dir/);
  } finally {
    if (saved === undefined) delete process.env.OPENCODE_CONFIG_DIR;
    else process.env.OPENCODE_CONFIG_DIR = saved;
    sb.cleanup();
  }
});

for (const host of ['bob', 'copilot']) {
  test(`the deploy command maps ${host} to its project emit`, () => {
    const sb = makeSandbox();
    try {
      const cmd = apiDeployCmd(neutral(),
        { host, path: sb.path, theme: 'imperial' }).cmd.map(String);
      assert.equal(after$(cmd, '--emit'), host, 'a deploy is a PROJECT emit, never global');
      assert.equal(after$(cmd, '--theme'), 'imperial');
    } finally { sb.cleanup(); }
  });
}

// IBM Bob and GitHub Copilot are first-class hosts: a project layer plus their own agents file,
// riding the CLAUDE-STYLE manifest lifecycle — deactivate stashes, reactivate restores.
const HOST_LAYOUT = {
  bob: { marker: '.bob', agents: 'AGENTS.md', cfg: ['.bob', 'settings.json'] },
  copilot: { marker: '.github', agents: 'AGENTS.md', cfg: null },
};

for (const host of ['bob', 'copilot']) {
  test(`the ${host} project emit rides the disable/reactivate lifecycle`, () => {
    const sb = makeSandbox();
    try {
      const root = emitProject(sb.path, host);
      const spec = HOST_LAYOUT[host];
      assert.ok(fs.statSync(path.join(root, spec.agents)).isFile(), `no ${spec.agents}`);
      assert.ok(fs.statSync(path.join(root, spec.marker)).isDirectory(), `no ${spec.marker}/`);
      assert.equal(installState(root, host, 'project'), 'active');

      const off = installDeactivate(root, host, 'project');
      assert.equal(off.ok, true, JSON.stringify(off));
      assert.equal(off.kind, host);
      assert.equal(installState(root, host, 'project'), 'disabled');

      const on = installReactivate(root, host, 'project');
      assert.equal(on.ok, true, JSON.stringify(on));
      assert.equal(installState(root, host, 'project'), 'active');
    } finally { sb.cleanup(); }
  });
}

test('bob is a flagless MCP host and its config lives under the project marker', () => {
  const sb = makeSandbox();
  try {
    assert.equal(mcpConfigFor('bob', 'project', sb.path),
      path.join(sb.path, '.bob', 'settings.json'));
  } finally { sb.cleanup(); }
});

// A bob PROJECT install's data lives under `<repo>/.bob`, not at the bare root, and a restore
// must render the BOB expected tree rather than OpenCode's — which would corrupt the agents'
// frontmatter.
//
// THE SECOND HALF CHANGED SHAPE WITH THE SEAM. The reference compared FUNCTION IDENTITY
// (`_global_emitter_for('bob-global') is build.emit_bob_global`); the port has no emitter
// objects to compare, because the emit dispatch crossed to a rendered decision. Its twin
// answers the HOST, and that is the value the restore actually routes on.
test('the view cfg and the restore emitter are host-correct', () => {
  assert.equal(viewCfg('bob', 'project', path.join('/r')), path.join('/r', '.bob'));
  assert.equal(viewCfg('bob', 'global', path.join('/r')), path.join('/r'));   // global == root

  assert.equal(globalEmitHostFor('bob-global'), 'bob');
  assert.equal(globalEmitHostFor('claude-global'), 'claude');
  assert.equal(globalEmitHostFor('opencode-global'), 'opencode');
  assert.equal(globalEmitHostFor(null), 'opencode', 'the safe fallback moved');
});

// Bob shares Claude's FLAG-LESS `mcpServers` shape: disabling REMOVES the server, because a
// stray `enabled: false` would be ignored by Bob and leave it live.
test('a flagless host removes the entry instead of flagging it', () => {
  const cfg = { mcpServers: { md: { command: 'uvx', args: ['x'] } } };
  assert.equal(mcpState(cfg, 'md', 'bob'), 'enabled');
  const off = mcpSetEnabled(cfg, 'md', false, 'bob');
  assert.deepEqual(off.mcpServers || {}, {});
});

for (const host of ['bob', 'copilot']) {
  test(`the ${host} theme is detected from its emitted agents file`, () => {
    const sb = makeSandbox();
    try {
      emitProject(sb.path, host, 'imperial');
      assert.equal(themeOfDir(sb.path), 'imperial');
    } finally { sb.cleanup(); }
  });
}

// ---------------------------------------------------------------------------------------------
// The registry: a deployed folder install persists in the installs list, and self-prunes the
// moment its root marker goes.

function withXdg(fn) {
  const sb = makeSandbox();
  const saved = process.env.XDG_CONFIG_HOME;
  try {
    process.env.XDG_CONFIG_HOME = path.join(sb.path, 'xdg');
    fs.mkdirSync(process.env.XDG_CONFIG_HOME, { recursive: true });
    return fn(sb.path);
  } finally {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved;
    sb.cleanup();
  }
}

test('the registry round-trips a recorded root and prunes it with its marker', () => {
  withXdg((tmp) => {
    const live = path.join(tmp, 'live');
    fs.mkdirSync(live, { recursive: true });
    fs.writeFileSync(path.join(live, '.geneseed-emit'), 'opencode\n');

    registryRecord(live);
    registryRecord(live);                         // idempotent
    const mine = installTargets().filter((r) => samePath(r[2], live));
    assert.deepEqual(mine.map((r) => [r[0], r[1]]), [['opencode', 'project']]);

    // Drop the marker: the registry self-prunes and the row disappears.
    fs.rmSync(path.join(live, '.geneseed-emit'));
    assert.deepEqual(registryRoots(), []);
    assert.deepEqual(installTargets().filter((r) => samePath(r[2], live)), []);
  });
});

// ---------------------------------------------------------------------------------------------
// The trash icon: the `remove` action permanently deletes a folder install and de-lists it.
// memory/ and notebook/ follow the `memory` disposition, and the file removal never touches
// them — so the DEFAULT `keep` cannot lose a learned fact.
//
// OpenCode project is the interesting case: no manifest, so the bundle dirs and AGENT.md are
// reversed BY NAME, which the generator owns and clobbers on every run.
function seedOpencodeProject(root) {
  fs.mkdirSync(root, { recursive: true });
  for (const d of ['.opencode', 'laws', 'agents', 'skills', 'memory', 'notebook']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
    fs.writeFileSync(path.join(root, d, 'f'), 'x');
  }
  fs.writeFileSync(path.join(root, 'AGENT.md'), '# rules\n');
  fs.writeFileSync(path.join(root, 'opencode.json'),
    JSON.stringify({ instructions: ['AGENT.md'], lsp: true }));
  fs.writeFileSync(path.join(root, '.geneseed-emit'), 'opencode\n');
  fs.writeFileSync(path.join(root, '.geneseed-theme'), 'neutral\n');
  fs.writeFileSync(path.join(root, VERSION_MARKER), 'v\n');
  return root;
}

test('removing an opencode project deletes its files and keeps memory', () => {
  const sb = makeSandbox();
  try {
    const root = seedOpencodeProject(path.join(sb.path, 'repo'));
    const res = installUninstall(root, 'opencode', 'project', 'keep');
    assert.equal(res.ok, true, JSON.stringify(res));

    for (const d of ['.opencode', 'laws', 'agents', 'skills']) {
      assert.ok(!fs.existsSync(path.join(root, d)), `${d} should be gone`);
    }
    assert.ok(!fs.existsSync(path.join(root, 'AGENT.md')));

    // opencode.json is KEPT; only its instructions entry is dropped. The file is the user's.
    const instr = JSON.parse(fs.readFileSync(path.join(root, 'opencode.json'), 'utf8')).instructions;
    assert.ok(!instr.includes('AGENT.md'));

    // The markers go, so the registry row self-prunes.
    for (const m of ['.geneseed-emit', '.geneseed-theme', VERSION_MARKER]) {
      assert.ok(!fs.existsSync(path.join(root, m)), m);
    }
    // memory and notebook survive — the default disposition cannot lose a fact.
    assert.ok(fs.existsSync(path.join(root, 'memory', 'f')));
    assert.ok(fs.existsSync(path.join(root, 'notebook', 'f')));
  } finally { sb.cleanup(); }
});

test('the memory disposition archives, then deletes', () => {
  const sb = makeSandbox();
  try {
    const root = seedOpencodeProject(path.join(sb.path, 'repo2'));
    assert.equal(installUninstall(root, 'opencode', 'project', 'archive').ok, true);
    assert.ok(!fs.existsSync(path.join(root, 'memory')), 'archive left the live dir behind');
    const archived = (name) => fs.readdirSync(path.join(root, name))
      .some((d) => fs.existsSync(path.join(root, name, d, 'f')));
    assert.ok(archived('archived-memory'), 'memory was moved aside but not preserved');
    assert.ok(archived('archived-notebook'));

    const root2 = seedOpencodeProject(path.join(sb.path, 'repo3'));
    const res2 = installUninstall(root2, 'opencode', 'project', 'delete');
    assert.equal(res2.ok, true);
    assert.ok(!fs.existsSync(path.join(root2, 'memory')));
    assert.ok(!fs.existsSync(path.join(root2, 'notebook')));
    assert.equal(res2.memory, 'delete');
  } finally { sb.cleanup(); }
});

// The remove action is DESTRUCTIVE and its path comes out of a request body, so the allowlist
// is the whole of its safety.
test('the remove action is wired and allowlisted', () => {
  const sb = makeSandbox();
  const cwd = process.cwd();
  try {
    const root = seedOpencodeProject(path.join(sb.path, 'repo4'));
    process.chdir(root);                     // `.opencode/` makes this a discovered project
    const st = neutral();
    assert.throws(() => apiInstallToggle(st,
      { host: 'opencode', path: '/nope', action: 'remove' }), NotFound);

    const res = apiInstallToggle(st,
      { host: 'opencode', path: process.cwd(), action: 'remove', memory: 'keep' });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.ok(!fs.existsSync(path.join(root, '.opencode')));
  } finally { process.chdir(cwd); sb.cleanup(); }
});

// Real per-repo emits, manifest-backed, so remove must reverse them HOST-AGNOSTICALLY.
for (const host of ['claude', 'bob', 'copilot']) {
  test(`removing a ${host} project install reverses it and keeps its memory`, () => {
    const sb = makeSandbox();
    try {
      const root = emitProject(sb.path, host);
      const marker = HOST_LAYOUT[host] ? HOST_LAYOUT[host].marker : '.claude';
      assert.equal(installState(root, host, 'project'), 'active');

      const res = installUninstall(root, host, 'project', 'keep');
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.equal(installState(root, host, 'project'), 'absent');
      assert.ok(!fs.existsSync(path.join(root, marker, GLOBAL_MANIFEST)));
      // The per-host store survives the removal under the default disposition.
      assert.ok(fs.statSync(path.join(root, marker, 'memory')).isDirectory());
    } finally { sb.cleanup(); }
  });
}

test('a removal de-registers through the registry prune', () => {
  withXdg((tmp) => {
    const root = seedOpencodeProject(path.join(tmp, 'deployed'));
    registryRecord(root);
    assert.ok(registryRoots().some((r) => samePath(r, root)));
    installUninstall(root, 'opencode', 'project', 'keep');
    // `.geneseed-emit` is gone, so the registry prunes the row on the next read.
    assert.deepEqual(registryRoots(), []);
  });
});

// ---------------------------------------------------------------------------------------------
// The About page's origin.
//
// THE REFERENCE MOCKED `_origin_display` TO RETURN A CONSTRUCTED VALUE, so what it really
// tested was the mapping from an OriginDisplay to the payload's two fields. ESM cannot rebind
// the import, and the honest split is better anyway: the DECISION is `parseOrigin`, which is
// pure and takes the URL directly, and the MAPPING is checkable against this checkout's own
// origin.
test('parseOrigin separates a GitHub origin from any other host', () => {
  assert.equal(parseOrigin('https://gitlab.corp/team/gs').url, 'https://gitlab.corp/team/gs');
  assert.ok(!parseOrigin('https://gitlab.corp/team/gs').githubSlug,
    'a non-GitHub origin was given a GitHub slug, which gates the deep links in the UI');
  assert.equal(parseOrigin('https://github.com/Own/Repo').githubSlug, 'Own/Repo');
});

// AND THE HALF THAT CANNOT BE REACHED, named rather than skipped silently: the non-GitHub arm
// of the ABOUT PAYLOAD needs an install whose git origin is not GitHub, and `originDisplay()`
// shells `git remote get-url origin` in this checkout. Changing that to prove a mapping would
// edit the developer's own remote. The mapping is one `Boolean(od.githubSlug)`, its input is
// gated absolutely above, and its GitHub arm is gated here.
test('the about payload reports this install own origin and its GitHub flag', () => {
  const body = apiDocsPage(neutral(), 'about', 'opencode');
  const od = originDisplay();
  assert.equal(body.repo, od.url);
  assert.equal(body.repo_is_github, Boolean(od.githubSlug));
});

// ---------------------------------------------------------------------------------------------
// `user-rules.md`: the seed-once stub, the parser, and the mutation/promotion endpoints —
// including the fingerprint conflict gate and SPLICE FIDELITY, which is the property that keeps
// a mutation inside one rule's block and out of the user's surrounding prose.
//
// THE STUB ARRIVES THROUGH A REAL EMIT. `ensureRulesStub` is private to `js/emit.mjs`, and
// reaching for it would have meant widening the module's face for a test. An emit is how a user
// gets the file, so an emit is what seeds the fixture — which also makes the seed-once test
// stronger than the reference's: it proves the guard on the path that actually re-runs it.
function rulesBox() {
  const sb = makeSandbox();
  const cfg = emitInto(path.join(sb.path, 'cfg'));
  return { sb, cfg, file: path.join(cfg, RULES_FILE), state: webState('neutral', cfg) };
}

const withRules = (fn) => {
  const box = rulesBox();
  try { return fn(box); } finally { box.sb.cleanup(); }
};

test('the rules stub is seeded once and never overwritten', () => {
  withRules((box) => {
    assert.ok(fs.statSync(box.file).isFile());
    fs.writeFileSync(box.file, 'MINE\n');
    emitInto(box.cfg);                      // a rebuild, the way a user re-runs it
    assert.equal(fs.readFileSync(box.file, 'utf8'), 'MINE\n',
      "a rebuild overwrote the user's own rules file");
  });
});

// The seeded format example is INDENTED, and the parser is anchored at column 0 — so the
// example must not read as a live rule.
test('the stub example does not parse as a rule', () => {
  withRules((box) => {
    const res = apiRules(box.state);
    assert.equal(res.exists, true);
    assert.deepEqual(res.rules, []);
    assert.deepEqual(res.warnings, []);
  });
});

test('a missing rules file reports not-seeded', () => {
  withRules((box) => {
    fs.rmSync(box.file);
    const res = apiRules(box.state);
    assert.equal(res.exists, false);
    assert.deepEqual(res.rules, []);
  });
});

// SPLICE FIDELITY: after add → update → delete the file is byte-identical to the seeded stub.
// A mutation that rewrote the whole document would pass every other assertion here.
test('add, update and delete round-trip while preserving the prose', () => {
  withRules((box) => {
    const before = fs.readFileSync(box.file, 'utf8');

    const r1 = apiRulesMutate(box.state, {
      op: 'add', fingerprint: apiRules(box.state).fingerprint,
      title: 'No emoji', body: 'Plain text only.', scope: 'project',
    });
    assert.equal(r1.ok, true, JSON.stringify(r1));
    assert.equal(Number(r1.id), 1);

    const r2 = apiRulesMutate(box.state, {
      op: 'update', id: 1, fingerprint: r1.fingerprint,
      title: 'No emoji anywhere', body: 'Ever.', scope: 'user', trial_until: '2026-12-31',
    });
    assert.equal(r2.ok, true, JSON.stringify(r2));

    const parsed = apiRules(box.state).rules;
    assert.equal(parsed[0].title, 'No emoji anywhere');
    assert.equal(parsed[0].scope, 'user');
    assert.equal(parsed[0].status, 'trial');

    const r3 = apiRulesMutate(box.state, { op: 'delete', id: 1, fingerprint: r2.fingerprint });
    assert.equal(r3.ok, true, JSON.stringify(r3));

    assert.equal(fs.readFileSync(box.file, 'utf8').replace(/\n+$/, ''),
      before.replace(/\n+$/, ''),
      'the file did not come back to the seeded stub — a mutation touched prose it does not own');
  });
});

// The fingerprint is the whole concurrency story: two console tabs, or a hand edit between a
// read and a write, must CONFLICT rather than clobber.
test('a stale fingerprint conflicts instead of clobbering', () => {
  withRules((box) => {
    const fp = apiRules(box.state).fingerprint;
    apiRulesMutate(box.state, { op: 'add', fingerprint: fp, title: 'First', body: 'Wins.' });

    const res = apiRulesMutate(box.state,
      { op: 'add', fingerprint: fp, title: 'Second', body: 'Loses.' });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'conflict');
    assert.deepEqual(apiRules(box.state).rules.map((r) => r.title), ['First']);
  });
});

test('add rejects an empty title or an empty body', () => {
  withRules((box) => {
    const fp = apiRules(box.state).fingerprint;
    for (const bad of [{ title: '', body: 'x' }, { title: 'x', body: ' ' }]) {
      assert.throws(() => apiRulesMutate(box.state, { op: 'add', fingerprint: fp, ...bad }),
        `${JSON.stringify(bad)} was accepted`);
    }
  });
});

test('duplicate rule ids warn', () => {
  withRules((box) => {
    fs.writeFileSync(box.file, '## R1 — A\nBody a.\n\n## R1 — B\nBody b.\n');
    assert.ok(apiRules(box.state).warnings.includes('duplicate rule id R1'),
      JSON.stringify(apiRules(box.state).warnings));
  });
});

test('promote moves a memory into a trial rule', () => {
  withRules((box) => {
    const mem = path.join(box.cfg, 'memory');
    fs.mkdirSync(mem, { recursive: true });
    fs.writeFileSync(path.join(mem, 'MEMORY.md'),
      '# Memory Index\n- [prefer-tabs](prefer-tabs.md) — hook\n');
    fs.writeFileSync(path.join(mem, 'prefer-tabs.md'),
      '---\nname: prefer-tabs\ndescription: use tabs\ntype: feedback\n---\n\n'
      + 'Always use tabs here.\n');

    const res = apiRulesPromote(box.state, {
      name: 'prefer-tabs', fingerprint: apiRules(box.state).fingerprint, delete_memory: true,
    });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.deleted_memory, 'prefer-tabs');
    assert.ok(!fs.existsSync(path.join(mem, 'prefer-tabs.md')));

    const rule = apiRules(box.state).rules[0];
    assert.equal(rule.status, 'trial', 'a promoted memory must start on trial, not approved');
    assert.match(rule.source, /memory prefer-tabs/);
    assert.equal(rule.body, 'Always use tabs here.');
  });
});

// The name comes out of a request body and is joined onto the memory dir, so a separator or a
// `..` would be an arbitrary-file read. `MEMORY` is in the list because the index is not a fact.
test('promote rejects traversal and index names', () => {
  withRules((box) => {
    fs.mkdirSync(path.join(box.cfg, 'memory'), { recursive: true });
    for (const bad of ['', 'a/b', '..\\x', 'MEMORY']) {
      assert.throws(() => apiRulesPromote(box.state, { name: bad, fingerprint: '' }), NotFound,
        `${JSON.stringify(bad)} resolved instead of 404ing`);
    }
  });
});
