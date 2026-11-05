// THE WEB API'S FUNCTIONS, IN PROCESS — jobs, build actions, themes, excludes and setup.
// One of the `web_api*.test.mjs` files split from a single file; shared fixtures live in
// `tests/helpers/web_api_fixture.mjs`.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildPlan } from '../../js/web/server.mjs';
import { apiThemes, apiExcludes, apiSetup } from '../../js/web/api.mjs';
import { apiRestore, buildOverride, apiExcludesMutate } from '../../js/web/actions.mjs';
import { GLOBAL_MANIFEST, resolvePath } from '../../js/hosts/hosts.mjs';
import { JobManager, actionCommands } from '../../js/web/jobs.mjs';
import { diffCollect } from '../../js/inspect/diff.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';
import { webFixtureTeardown } from '../helpers/web_fixture.mjs';
import { withGlobalInstalls as withGlobalInstallsFixture } from '../helpers/installs_fixture.mjs';
import {
  neutral, node, until, asPosix, serve, fetchStatus, webState, emitInto,
} from '../helpers/web_api_fixture.mjs';

after(webFixtureTeardown);

async function waitJob(jm, jid, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const j = jm.get(jid);
    if (j && j.status !== 'running') return j;
    assert.ok(Date.now() < deadline, `job ${jid} never left running: ${JSON.stringify(j)}`);
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
// Restore.

/** Claim `rels` in the install's manifest, the way an older emit that wrote them would have. */
function ownInManifest(cfg, ...rels) {
  const man = path.join(cfg, GLOBAL_MANIFEST);
  const data = JSON.parse(fs.readFileSync(man, 'utf8'));
  data.owned = [...new Set([...data.owned, ...rels])].sort();
  fs.writeFileSync(man, JSON.stringify(data));
}

// Restore acts ONLY on what `/api/diff` offers, computed server-side. A file the install does not
// own — `zz-extra.md`, dropped in by hand — is never in the drift list, so naming it in the POST is
// an error and its bytes stay put. It used to be unlinked: the endpoint trusted the client's list,
// and one POST deleted any file under the install (an audit removed `auth-secret.json` that way).
test('restore rewrites an edit and refuses a path the diff does not offer', () => {
  const sb = makeSandbox();
  try {
    const cfg = emitInto(path.join(sb.path, 'cfg'));
    const st = webState('neutral', cfg);
    const agent = path.join(cfg, 'AGENT.md');
    const original = fs.readFileSync(agent, 'utf8');
    fs.writeFileSync(agent, `${original}\nLOCAL EDIT\n`);
    const extra = path.join(cfg, 'zz-extra.md');
    fs.writeFileSync(extra, 'local only\n');
    const extraBytes = fs.readFileSync(extra);

    const res = apiRestore(st, ['AGENT.md', 'zz-extra.md', 'bogus.md', '../escape.md']);

    assert.ok(res.restored.includes('AGENT.md'), 'the edited file was not restored');
    assert.equal(fs.readFileSync(agent, 'utf8'), original);
    assert.deepEqual(res.deleted, [], 'restore removed a file the diff never offered');
    assert.ok(fs.readFileSync(extra).equals(extraBytes), 'a non-diff path was touched');
    assert.equal(res.errors.length, 3,
      'the unowned file, the unknown name and the traversal must all error');
  } finally { sb.cleanup(); }
});

// An 'added' file is one the install's manifest owns and the source no longer renders. Restore
// MOVES it into `archived-restore/<stamp>/` inside the install — the `archived-<name>/<stamp>`
// shape uninstall uses for memory — so "discard" is recoverable, and the next diff does not list
// the archive (nothing owns it). The rel itself reads `missing` afterwards, as it did after the
// old unlink: the manifest still claims it until the next emit prunes it.
test('restore archives an added file instead of deleting it', () => {
  const sb = makeSandbox();
  try {
    const cfg = emitInto(path.join(sb.path, 'cfg'));
    const added = path.join(cfg, 'agents', 'zz-retired.md');
    fs.writeFileSync(added, 'an agent the source no longer ships\n');
    const bytes = fs.readFileSync(added);
    ownInManifest(cfg, 'agents/zz-retired.md');
    const before = diffCollect({ target: cfg }).files.find((f) => f.rel === 'agents/zz-retired.md');
    assert.equal(before?.status, 'added', 'the fixture did not make an added file');

    const res = apiRestore(webState('neutral', cfg), ['agents/zz-retired.md']);

    assert.deepEqual(res.errors, []);
    assert.deepEqual(res.deleted, ['agents/zz-retired.md']);
    assert.ok(!fs.existsSync(added), 'the added file is still in place');
    assert.equal(path.dirname(res.archive), path.join(cfg, 'archived-restore'));
    assert.ok(fs.readFileSync(path.join(res.archive, 'agents', 'zz-retired.md')).equals(bytes),
      'the archived copy is not the deleted file byte for byte');
    const after = diffCollect({ target: cfg }).files.map((f) => f.rel);
    assert.deepEqual(after.filter((r) => r.startsWith('archived-restore/')), [],
      'the archive shows up as drift');
  } finally { sb.cleanup(); }
});

// The seed-once files are the user's after the first build — never in a render's owned set, so
// the diff never offers them. Restore refuses them EVEN WHEN it does: a manifest that claims
// them (hand-edited, or a future emit bug) must not turn "restore" into "reset my rules to the
// stub". Forced into the manifest here so the drift check alone cannot be what refuses them.
test('restore never replaces a seed-once user file', () => {
  const sb = makeSandbox();
  try {
    const cfg = emitInto(path.join(sb.path, 'cfg'));
    const rels = ['user-rules.md', 'PROFILE.md', 'memory/MEMORY.md', 'notebook/NOTEBOOK.md'];
    const before = new Map();
    for (const rel of rels) {
      fs.appendFileSync(path.join(cfg, rel), '\nMY OWN EDIT\n');
      before.set(rel, fs.readFileSync(path.join(cfg, rel)));
    }
    ownInManifest(cfg, ...rels);
    const offered = diffCollect({ target: cfg }).files.map((f) => f.rel);
    assert.ok(rels.every((r) => offered.includes(r)), 'the fixture did not put the seeds in the diff');

    const res = apiRestore(webState('neutral', cfg), rels);

    assert.deepEqual(res.restored, []);
    assert.deepEqual(res.deleted, []);
    assert.equal(res.errors.length, rels.length);
    for (const rel of rels) {
      assert.ok(fs.readFileSync(path.join(cfg, rel)).equals(before.get(rel)), `${rel} was replaced`);
    }
  } finally { sb.cleanup(); }
});

// The legacy `anamnesis/` store was a seed-once folder too (SESSION_FILES named it until the memory
// store moved), and restore refused it. SESSION_FILES no longer lists it, so the refusal is spelled.
test('restore never replaces a file under the legacy anamnesis/ store', () => {
  const sb = makeSandbox();
  try {
    const cfg = emitInto(path.join(sb.path, 'cfg'));
    const rel = 'anamnesis/MEMORY.md';
    fs.mkdirSync(path.join(cfg, 'anamnesis'));
    fs.writeFileSync(path.join(cfg, rel), 'MY OWN MEMORY\n');
    ownInManifest(cfg, rel);
    assert.ok(diffCollect({ target: cfg }).files.some((f) => f.rel === rel),
      'the fixture did not put the file in the diff');
    const res = apiRestore(webState('neutral', cfg), [rel]);
    assert.deepEqual(res.restored, []);
    assert.deepEqual(res.deleted, []);
    assert.equal(res.errors.length, 1);
    assert.equal(fs.readFileSync(path.join(cfg, rel), 'utf8'), 'MY OWN MEMORY\n');
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
    assert.equal(snap.excludes[0].path.replace(/\/+$/, ''), asPosix(resolvePath(repo)));

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
