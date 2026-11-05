// SHARED FIXTURES FOR THE `web_api_*.test.mjs` FILES, split out of the one 4 700-line
// `web_api.test.mjs` that was the suite's critical path. Each file is its own process, so each
// builds the shared install once and runs its own doctor at most once per theme.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { makeHandler } from '../../js/web/handler.mjs';
import { apiInstalls } from '../../js/web/api.mjs';
import { webState as realWebState } from '../../js/web/state.mjs';
import { RULES_FILE } from '../../js/web/user-files.mjs';
import { installState } from '../../js/hosts/installs.mjs';
import { GLOBAL_MANIFEST, VERSION_MARKER, resolvePath } from '../../js/hosts/hosts.mjs';
import { normcase } from '../../js/lib/paths.mjs';
import { JobManager } from '../../js/web/jobs.mjs';
import { initState, renderLoopFile } from '../../js/loop/state.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';
import { webFixture, dropSandboxTier, ROOT } from '../helpers/web_fixture.mjs';


// `js/web/api.mjs` keeps its own `samePath` module-private. Rebuilt here from the same two
// primitives rather than exported from the product for a test's benefit — and it must be
// `normcase(resolvePath(...))` on both sides, because on Windows the two spellings this
// comparison exists to reconcile differ in CASE as well as in shape.
export const samePath = (a, b) => normcase(resolvePath(a)) === normcase(resolvePath(b));

export const FIXTURE = webFixture();


// ONE REAL DOCTOR PER THEME FOR THE WHOLE FILE. `apiOverview` and `apiFleet` read the verdict, so
// every state that reached them paid a full `doctorCollect`: 14 runs, 44% of this file's profile.
// The run takes only the theme from the state, so a state's first ask replays the theme's one real
// verdict. The doctor also reads the machine (env, OpenCode dirs, hook shim), so the verdict is the
// one the first ask saw: a test that asserts verdict content under a changed env needs
// `realWebState`. Only `runDoctor` is replaced: `_doctor` still starts null, and the getter, the
// cache and the warm-up run as shipped. The `?fresh=1` test takes `realWebState` too, a real run
// being its subject.
const verdicts = new Map();
export function webState(...args) {
  const st = realWebState(...args);
  const run = st.runDoctor;
  st.runDoctor = () => {
    const seen = verdicts.get(st.theme);
    if (seen) { st.stampDoctor(...seen); return; }
    run();
    verdicts.set(st.theme, [st._doctor.problems, st._doctorRun.themes, st._doctorRun.groups]);
  };
  return st;
}

// A REAL INSTALL AT A CHOSEN FOOTPRINT, through the shipping driver rather than through an
// internal render call. The reference could say `build.emit_opencode_global(..., cfg=...)`
// because the config dir was a function argument; the port resolves it from the environment,
// which is the same path a user's `geneseed build` takes. `--out` is the source bundle, `cfg`
// is where the install lands.
export function emitInto(cfg, {
  footprint = 'full', theme = 'neutral', out = null, extra = [],
} = {}) {
  const proc = spawnSync(process.execPath,
    [path.join(ROOT, 'bin', 'build-driver.mjs'), '--emit', 'opencode-global',
      '--theme', theme, '--footprint', footprint, '--out', out || `${cfg}-bundle`, ...extra],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, OPENCODE_CONFIG_DIR: cfg } });
  assert.equal(proc.status, 0, `emit into ${cfg} failed:\n${proc.stdout}\n${proc.stderr}`);
  dropSandboxTier();
  return cfg;
}

// ---------------------------------------------------------------------------------------------
// The catalog and the overview.

export const neutral = () => webState('neutral');

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
export const node = (src) => [process.execPath, '-e', src];

export async function until(pred, what, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await new Promise((r) => { setTimeout(r, 20); });
  }
}

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
// yields a global row for claude, bob and openclaude, all `absent`. The property under test is
// about the ROW — its keys, its host, its scope, its path, its state — so the port selects the
// row by path and asserts on it. The count assertion measured the monkeypatch, not the code.
export const DISABLED = '.geneseed-disabled';

export const asPosix = (p) => p.split(path.sep).join('/');

export function withGlobalRoot(fn) {
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

export const agentEntry = (root) => `${asPosix(root)}/AGENT.md`;

// A minimal GLOBAL install: AGENT.md + agents/x.md + a manifest listing them (plus
// VERSION_MARKER, the one marker the real manifest carries) + an opencode.json whose
// `instructions` already points at AGENT.md.
export function seedGlobal(root, opencodeText = null) {
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

export const rowFor = (state, root) => {
  const rows = apiInstalls(state).installs;
  const row = rows.find((r) => samePath(r.path, root));
  assert.ok(row, `no install row for ${root}; discovery returned `
    + `${JSON.stringify(rows.map((r) => [r.host, r.scope, r.path]))}`);
  return row;
};

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
export function withThreeInstalls(fn) {
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

// ---------------------------------------------------------------------------------------------
// A named install (`installView`) reads that install's own target, theme and emit; there is no
// console-wide selection to move (the topbar selector and `POST /api/view` are gone).

export function withTwoViews(fn) {
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

// ---------------------------------------------------------------------------------------------
// Per-request install (D5): every request may name its install — `?host=&path=` on a read,
// `{host, path}` in a write body — and is answered for THAT install, on the same daemon, without
// any console-wide selection. The pair goes through the detected-install allowlist; an unknown or
// half pair is a 404, never another dir. Naming none answers for the default install.
//
// The fixture is `withTwoViews`, awaited: an opencode global (theme neutral, the daemon's view,
// the only one with a manifest) and a claude global whose markers say claude-global / imperial.

export async function withTwoViewsServed(fn, { jm = new JobManager() } = {}) {
  const sb = makeSandbox();
  const savedOc = process.env.OPENCODE_CONFIG_DIR;
  const cl = path.join(os.homedir(), '.claude');
  try {
    const oc = path.join(sb.path, 'oc');
    fs.mkdirSync(oc, { recursive: true });
    fs.writeFileSync(path.join(oc, GLOBAL_MANIFEST), JSON.stringify({ owned: [] }));
    process.env.OPENCODE_CONFIG_DIR = oc;
    fs.mkdirSync(cl, { recursive: true });
    fs.writeFileSync(path.join(cl, '.geneseed-emit'), 'claude-global');
    fs.writeFileSync(path.join(cl, '.geneseed-theme'), 'imperial');
    const st = webState('neutral', oc);
    // The (host, path) pairs exactly as `/api/installs` hands them to the client.
    const pair = (host, dir) => {
      const row = apiInstalls(st).installs.find((r) => r.host === host && samePath(r.path, dir));
      assert.ok(row, `no ${host} install row for ${dir}`);
      return { host, path: row.path };
    };
    const srv = http.createServer(makeHandler(st, jm, 'tok', path.join(ROOT, 'web', 'dist')));
    await new Promise((r) => { srv.listen(0, '127.0.0.1', r); });
    const base = `http://127.0.0.1:${srv.address().port}`;
    const q = (p) => (p ? `?${new URLSearchParams(p)}` : '');
    const get = (url, p) => fetch(`${base}${url}${q(p)}`);
    const post = (url, body) => fetch(`${base}${url}`, { method: 'POST',
      headers: { 'x-geneseed-token': 'tok', 'content-type': 'application/json' },
      body: JSON.stringify(body) });
    try {
      return await fn({ st, oc, cl, ocPair: pair('opencode', oc), clPair: pair('claude', cl), get, post });
    } finally {
      await new Promise((r) => { srv.close(r); });
    }
  } finally {
    fs.rmSync(cl, { recursive: true, force: true });
    if (savedOc === undefined) delete process.env.OPENCODE_CONFIG_DIR;
    else process.env.OPENCODE_CONFIG_DIR = savedOc;
    sb.cleanup();
  }
}

// One memory fact, `fact`, with its index line, in an install's memory store.
export function seedFact(dir) {
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'memory', 'MEMORY.md'), '# Memory\n\n- [Fact](fact.md) — a fact\n');
  fs.writeFileSync(path.join(dir, 'memory', 'fact.md'),
    '---\nname: Fact\ndescription: a fact\n---\nThe fact body.\n');
}

// ---------------------------------------------------------------------------------------------
// The handler, over a real socket. The 114 web cells own the shell in depth; these two are the
// wiring check that the dispatcher is reachable at all and that the CSRF gate is on.

export async function serve(fn) {
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

export const fetchStatus = (port, urlPath, init = {}) =>
  fetch(`http://127.0.0.1:${port}${urlPath}`, init);

// ---- Snapshot v2 (the Activity garden). `plain` unwraps the parser's number wrappers, so a
// table can state its answers as plain JSON.
export const plain = (v) => JSON.parse(JSON.stringify(v));

// B5 + D11: a collision is two or more distinct writers `(sid, by)` on the same `(repo, path)`
// among LIVE sessions. `same-worktree` (the red thread) when two of the writers share `root`;
// `cross-worktree` (amber) when every writer is in a different worktree of one repo. A session
// and its own sub-agent are two writers. Two `index.js` files in different folders are not one
// file. A v1 row (no `path`) and an ended session take no part.
//
// Roots compare through `normcase`, so Bob's lower-case `c:\` meets Claude's `C:\` on Windows,
// where the filesystem folds case. On POSIX `normcase` folds nothing and those are two repos.
export const R = 'C:\\w\\main';

export const item = (p, by = null) => ({ file: p.split('/').pop(), path: p, additions: 1, deletions: 0, by });

// ---------------------------------------------------------------------------------------------
// `user-rules.md`: the seed-once stub, the parser, and the mutation/promotion endpoints —
// including the fingerprint conflict gate and SPLICE FIDELITY, which is the property that keeps
// a mutation inside one rule's block and out of the user's surrounding prose.
//
// THE STUB ARRIVES THROUGH A REAL EMIT. `ensureRulesStub` is exported by `js/build/stubs.mjs`, and
// reaching for it would have meant widening the module's face for a test. An emit is how a user
// gets the file, so an emit is what seeds the fixture — which also makes the seed-once test
// stronger than the reference's: it proves the guard on the path that actually re-runs it.
export function rulesBox() {
  const sb = makeSandbox();
  const cfg = emitInto(path.join(sb.path, 'cfg'));
  return { sb, cfg, file: path.join(cfg, RULES_FILE), state: webState('neutral', cfg) };
}

export const withRules = (fn) => {
  const box = rulesBox();
  try { return fn(box); } finally { box.sb.cleanup(); }
};

// RETIRE MOVES, IT NEVER DELETES. The client still sends op `delete`; the server cuts the block
// out of user-rules.md and appends it, verbatim, to user-rules-retired.md beside it — a file no
// session loads, so a retired rule can never be obeyed by mistake. The first retire creates it
// under a one-line header; a second appends below the first; a retire of a gone rule is NotFound
// and writes NEITHER file.
//
// `writeText` writes the platform EOL, so on Windows the files hold CRLF. The rows here are
// written with `\n` and compared against the file read back with its CRLF folded.
export function readLf(file) { return fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n'); }

// ---------------------------------------------------------------------------------------------
// LOOPS ACTIVE TAB — `GET /api/loops/active` + `POST /api/loops/preset`. `apiLoopsActive` is a
// thin wrapper over `activeLoops` (registry behaviour itself is `tests/unit/loop_registry.test.mjs`'s
// claim), so these only need to prove the wrapper shape and the wiring; `apiLoopsPresetMutate`
// owns the two refusals the brief asks for, turning `setLoopPreset`'s throw into the same
// `NotFound` → 404 convention every other mutating route here answers in.

/** A minimal but real graph — the same fixture `loop_registry.test.mjs` uses — just enough for
 * `initState` to produce a genuine LOOP.md; these tests are about the API wrapper, not the
 * engine that writes the file. */
export const ACTIVE_TAB_GRAPH = {
  name: 'g', start: 'a',
  loops: [{ name: 'iter', iteration: true, nodes: ['a'], max: 5 }],
  edges: [{ from: 'a', on: 'pass', to: '$close' }],
  weights: {},
};

export function withLoopsXdg(sb, fn) {
  const saved = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(sb.path, 'xdg');
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved;
  }
}

export function makeLoopWorktree(sb, name, preset = 'balanced') {
  const root = path.join(sb.path, name);
  fs.mkdirSync(root, { recursive: true });
  const state = initState({ title: 'T', requirement: 'R', graph: ACTIVE_TAB_GRAPH, preset });
  fs.writeFileSync(path.join(root, 'LOOP.md'), renderLoopFile(state));
  return root;
}
