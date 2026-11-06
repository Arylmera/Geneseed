// `--shared-tier on|off` — the project install's switch for reading the machine tier (spec D11).
//
// Written out, not recorded. The properties this file holds:
//   1. the flag takes `on` or `off` only; `on` is refused for a global or bundle emit (a global
//      install owns the tier), and `off` is the default
//   2. off is byte-identical: a build without the flag and with `--shared-tier off` write the same
//      tree, with no `Shared tier` line; `on` adds exactly the marker line and its blank line
//   3. the marker reads back (`sharedTierOfDir`, `installProfile`), the rebuild argv keeps
//      `--shared-tier on`, a replay of it writes the same carrier, and an off install has no flag
//   4. a global install diffs clean: the option adds no drift where it does not apply
//   5. the injection table, on both host families, one test per row:
//        global install only              -> the global hook / plugin injects the tier
//        project wired, option off        -> the global hook stands down; the project injects no tier
//        project on                       -> the project hook injects it, labelled, before the project docs
//        project on + $GENESEED_STACK_GLOBAL -> the global hook injects, the project hook does not
//        plugin: project on, global install exists -> the project plugin skips; none exists -> it injects
//   6. the trade sentences are one text: cost.mjs writes them, `--help`, the console and the docs quote it
//   7. the `setup` prompt asks for a per-repo install only, shows this machine's token figure, and
//      carries the answer into the build argv and the status row
// If a rule below is wrong, change the row AND the sentence above it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';

import { main as driverMain, emitGlobalInto } from '../../js/build/driver.mjs';
import { installProfile, setupBuildArgs } from '../../js/build/generate.mjs';
import { diffCollect } from '../../js/inspect/diff.mjs';
import { statusLines } from '../../js/inspect/status.mjs';
import { SHARED_TIER_BENEFIT, alwaysOnCost, sharedTierCost, sharedTierFigure } from '../../js/inspect/cost.mjs';
import { OUTPUT_BUDGET, cmdContext, sessionFiles, sessionStartSize } from '../../js/hosts/hooks-context.mjs';
import { GLOBAL_MANIFEST } from '../../js/hosts/hosts.mjs';
import { appendAgentLesson } from '../../js/hosts/memory-files.mjs';
import { sharedTierOfDir } from '../../js/hosts/installs.mjs';
import { excludeAdd, foldExcludes } from '../../js/inspect/excludes.mjs';
import { memoryDir, tierOf } from '../../js/web/catalog.mjs';
import { sharedPaths } from '../../js/lib/machine-dir.mjs';
import { makeSandbox, restoreProcessHome, sandboxProcessHome } from '../helpers/sandbox.mjs';

// FIRST: a per-repo emit writes the hook shim and the registry into the environment's home.
sandboxProcessHome();
const sandboxes = [];
after(() => { for (const sb of sandboxes) sb.cleanup(); restoreProcessHome(); });
const sandbox = (prefix) => { const sb = makeSandbox(prefix); sandboxes.push(sb); return sb.path; };

/** Runs `fn`, returning its value and everything it wrote to stdout and stderr. */
function capture(fn) {
  const o = process.stdout.write; const e = process.stderr.write;
  let out = ''; let err = '';
  process.stdout.write = (s) => { out += String(s); return true; };
  process.stderr.write = (s) => { err += String(s); return true; };
  try { return { value: fn(), out, err }; } finally { process.stdout.write = o; process.stderr.write = e; }
}

const build = (...argv) => capture(() => driverMain(argv));
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const MARKER = /^Shared tier: on$/m;

/** Every file under `dir`, relative, with its bytes: two builds are equal when these are. */
function tree(dir, rel = '', acc = new Map()) {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.posix.join(rel, e.name);
    if (e.isDirectory()) tree(dir, r, acc);
    else acc.set(r, fs.readFileSync(path.join(dir, r)).toString('latin1'));
  }
  return acc;
}

// ---- 1. the flag ---------------------------------------------------------------------------------

test('the flag takes on or off, and refuses anything else by name', () => {
  const r = build('--emit', 'claude', '--out', sandbox('gsst-bad-'), '--shared-tier', 'maybe');
  assert.equal(r.value, 2);
  assert.match(r.err, /argument --shared-tier: invalid choice: 'maybe' \(choose from 'on', 'off'\)/);
});

for (const emit of ['claude-global', 'opencode-global', 'files']) {
  test(`on is refused for a ${emit} emit, because a global install owns the tier`, () => {
    const argv = ['--emit', emit, '--shared-tier', 'on'];
    if (emit.endsWith('-global')) argv.push('--config-dir', sandbox('gsst-g-'));
    else argv.push('--out', sandbox('gsst-f-'));
    const r = build(...argv);
    assert.equal(r.value, 2);
    assert.match(r.err, /argument --shared-tier: only applies to a per-repo host emit/);
  });
}

// ---- 2. off is byte-identical ----------------------------------------------------------------------

for (const emit of ['claude', 'opencode', 'bob', 'openclaude']) {
  test(`${emit}: off writes the tree a build without the flag writes; on adds only the marker`, () => {
    // One directory, wiped between builds, so every path the files name is the same string.
    const d = sandbox(`gsst-${emit}-`);
    const snap = (...flag) => {
      fs.rmSync(d, { recursive: true, force: true });
      fs.mkdirSync(d);
      assert.equal(build('--emit', emit, '--out', d, '--theme', 'neutral', ...flag).value, 0);
      return tree(d);
    };
    const plain = snap();
    const off = snap('--shared-tier', 'off');
    const on = snap('--shared-tier', 'on');
    assert.deepEqual([...off], [...plain], 'off differs from no flag');
    for (const [k, v] of plain) assert.ok(!/^Shared tier:/m.test(v), `${k} carries a marker with the option off`);
    assert.deepEqual([...on.keys()], [...plain.keys()], 'on adds or drops a file');
    const changed = [...on].filter(([k, v]) => v !== plain.get(k));
    const carriers = changed.filter(([, v]) => MARKER.test(v));
    assert.ok(carriers.length >= 1, 'on wrote no marker');
    // The marker block is the whole difference of a carrier: a blank line, the marker, a newline.
    for (const [k, v] of carriers) {
      assert.equal(v.replace(/\r?\nShared tier: on\r?\n/, ''), plain.get(k), `${k} differs by more than the marker`);
    }
    // The manifest records each owned file's hash, so it follows the carrier; nothing else may move.
    const others = changed.filter(([, v]) => !MARKER.test(v)).map(([k]) => k);
    assert.ok(others.every((k) => k.endsWith('.geneseed-manifest.json')), others.join(', '));
  });
}

// ---- 3. read-back, replay, status -----------------------------------------------------------------

test('the marker reads back, the rebuild argv keeps it, and a replay writes the same carrier', () => {
  const d = sandbox('gsst-rt-');
  assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral', '--shared-tier', 'on').value, 0);
  assert.equal(sharedTierOfDir(d, 'claude'), true);
  const p = installProfile('claude', 'project', d);
  assert.equal(p.sharedTier, true);
  assert.deepEqual(p.argv.slice(-2), ['--shared-tier', 'on']);
  const before = read(d, 'CLAUDE.md');
  assert.equal(build(...p.argv).value, 0);
  assert.equal(read(d, 'CLAUDE.md'), before, 'a rebuild changed the carrier');
  assert.match(before, MARKER);
});

test('an install with the option off reads false and its argv has no flag', () => {
  const d = sandbox('gsst-off-');
  assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral').value, 0);
  assert.equal(sharedTierOfDir(d, 'claude'), false);
  const p = installProfile('claude', 'project', d);
  assert.equal(p.sharedTier, false);
  assert.ok(!p.argv.includes('--shared-tier'), p.argv.join(' '));
  // The same call with `off` in the argv writes no marker even over an install that had it.
  assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral', '--shared-tier', 'on').value, 0);
  assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral', '--shared-tier', 'off').value, 0);
  assert.equal(sharedTierOfDir(d, 'claude'), false);
});

test('setupBuildArgs spells --shared-tier on last, and only when on', () => {
  const base = ['neutral', 'claude', '/r', '/r', 'lean', 'peer', 'direct', null, ['craft']];
  assert.ok(!setupBuildArgs(...base).includes('--shared-tier'));
  assert.deepEqual(setupBuildArgs(...base, null, undefined, null, {}, null, true).slice(-2), ['--shared-tier', 'on']);
});

test('status shows the switch in an install row only when it is on', () => {
  const base = {
    version_verdict: 'in sync', theme: 'neutral', accent: 'x', emit: 'claude', agents: 1,
    skills: 1, laws: 1, memory_dir: null, facts: 0, installed_fp: 'a', source_fp: 'a',
  };
  const row = { host: 'claude', scope: 'project', root: 'r', state: 'ok', theme: 'neutral',
    footprint: 'full', posture: 'peer', mode: 'direct', trust: 't', doctrines: ['craft'] };
  assert.match(statusLines({ ...base, installs: [{ ...row, sharedTier: true }] }).join('\n'), /shared tier: on/);
  assert.ok(!statusLines({ ...base, installs: [{ ...row, sharedTier: false }] }).join('\n').includes('shared tier'));
});

// ---- 4. diff --------------------------------------------------------------------------------------

test('a global install diffs clean with the option in the tree', () => {
  const cfg = sandbox('gsst-diff-');
  assert.equal(build('--emit', 'opencode-global', '--config-dir', cfg, '--theme', 'neutral').value, 0);
  assert.ok(fs.existsSync(path.join(cfg, GLOBAL_MANIFEST)));
  // `files` lists drift only: a clean install has none.
  assert.deepEqual(capture(() => diffCollect({ target: cfg, emit: 'opencode-global' })).value.files, []);
});

test('a carrier rendered with the marker diffs clean: diff reads the marker back and renders it', () => {
  const cfg = sandbox('gsst-diff2-');
  capture(() => emitGlobalInto('opencode', { theme: 'neutral', out: path.join(cfg, 'bundle'), cfgDir: cfg, footprint: 'full', sharedTier: true }));
  assert.match(read(cfg, 'AGENT.md'), MARKER);
  const clean = capture(() => diffCollect({ target: cfg, emit: 'opencode-global' })).value.files;
  assert.deepEqual(clean, []);
  // And the gate can fail: a hand edit to the same carrier is reported, so the clean result above was a real compare.
  fs.writeFileSync(path.join(cfg, 'AGENT.md'), read(cfg, 'AGENT.md').replace('Active packs:', 'Active packs (edited):'));
  const drift = capture(() => diffCollect({ target: cfg, emit: 'opencode-global' })).value.files;
  assert.deepEqual(drift.map((f) => f.rel), ['AGENT.md']);
});

// ---- 5. the injection table: Claude-family hook ---------------------------------------------------

const WIRED = ['context', 'git-gate', 'learn']
  .map((verb) => ({ event: 'X', group: { hooks: [{ type: 'command', command: `hook ${verb} --root r` }] } }));

/**
 * A machine with a tier, a global claude install and a project repo. `on` picks the option.
 * Returns the paths and `ctx(root)`, the context hook run at `root` against the repo.
 */
function world(on) {
  const d = sandbox('gsst-w-');
  const xdg = path.join(d, 'xdg');
  const gcfg = path.join(d, 'home', '.claude');
  const repo = path.join(d, 'repo');
  fs.mkdirSync(path.join(gcfg), { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(gcfg, '.geneseed-emit'), 'claude-global\n');
  fs.writeFileSync(path.join(gcfg, GLOBAL_MANIFEST), JSON.stringify({ managed: { settings_hooks: WIRED } }));
  fs.writeFileSync(path.join(gcfg, 'settings.json'), JSON.stringify({ hooks: { X: WIRED.map((r) => r.group) } }));
  fs.writeFileSync(path.join(repo, 'README.md'), '# the project\n');
  const argv = ['--emit', 'claude', '--out', repo, '--theme', 'neutral'];
  if (on) argv.push('--shared-tier', 'on');
  const saved = ['XDG_CONFIG_HOME', 'GENESEED_ROOT', 'GENESEED_WIKI', 'GENESEED_STACK_GLOBAL', 'CLAUDE_PROJECT_DIR']
    .map((v) => [v, process.env[v]]);
  process.env.XDG_CONFIG_HOME = xdg;
  process.env.GENESEED_ROOT = repo;
  for (const v of ['GENESEED_WIKI', 'GENESEED_STACK_GLOBAL', 'CLAUDE_PROJECT_DIR']) delete process.env[v];
  assert.equal(build(...argv).value, 0);
  const tier = sharedPaths();
  fs.mkdirSync(tier.root, { recursive: true });
  fs.writeFileSync(tier.rules, 'TIER-RULE keep the plan visible\n');
  const ctx = (root) => {
    const r = capture(() => cmdContext({ root }));
    assert.equal(r.value, 0);
    return r.out.replace(/\r\n/g, '\n');
  };
  const restore = () => {
    for (const [v, val] of saved) { if (val === undefined) delete process.env[v]; else process.env[v] = val; }
  };
  return { d, gcfg, repo, pcfg: path.join(repo, '.claude'), ctx, restore };
}

const TIER_HEAD = '----- user-rules.md (shared) -----';

test('hook: a global install alone injects the tier', () => {
  const w = world(false);
  try {
    fs.rmSync(path.join(w.repo, '.claude'), { recursive: true, force: true });
    assert.ok(w.ctx(w.gcfg).includes(`${TIER_HEAD}\nTIER-RULE keep the plan visible`));
  } finally { w.restore(); }
});

test('hook: a project wired for context with the option off stands the global hook down and injects no tier', () => {
  const w = world(false);
  try {
    assert.equal(w.ctx(w.gcfg).trim(), '', 'the global hook injected beside a wired project');
    const own = w.ctx(w.pcfg);
    assert.ok(own.includes('PROJECT CONTEXT'), own);
    assert.ok(!own.includes('TIER-RULE') && !own.includes('(shared)'), own);
  } finally { w.restore(); }
});

test('hook: a project with the option on injects the tier, labelled, before its own docs', () => {
  const w = world(true);
  try {
    const own = w.ctx(w.pcfg);
    const at = own.indexOf(`${TIER_HEAD}\nTIER-RULE keep the plan visible`);
    assert.ok(at >= 0, own);
    assert.ok(at < own.indexOf('PROJECT CONTEXT'), 'the tier must load before the project docs');
    assert.equal(w.ctx(w.gcfg).trim(), '', 'the global hook must still stand down');
    assert.equal(own.split('TIER-RULE').length, 2, 'the tier arrived more than once');
  } finally { w.restore(); }
});

test('hook: a project own rules file keeps its place beside the tier, host layer after shared', () => {
  const w = world(true);
  try {
    fs.mkdirSync(w.pcfg, { recursive: true });
    fs.writeFileSync(path.join(w.pcfg, 'user-rules.md'), 'PROJECT-RULE narrower\n');
    const own = w.ctx(w.pcfg);
    assert.ok(own.indexOf(TIER_HEAD) >= 0 && own.indexOf('PROJECT-RULE') > own.indexOf(TIER_HEAD), own);
    assert.match(own, /----- user-rules\.md \(host: claude\) -----\nPROJECT-RULE narrower/);
  } finally { w.restore(); }
});

test('hook: under GENESEED_STACK_GLOBAL the global hook injects the tier and the project hook does not', () => {
  const w = world(true);
  try {
    process.env.GENESEED_STACK_GLOBAL = '1';
    const global = w.ctx(w.gcfg);
    assert.ok(global.includes(`${TIER_HEAD}\nTIER-RULE`), global);
    const own = w.ctx(w.pcfg);
    assert.ok(own.includes('PROJECT CONTEXT'), own);
    assert.ok(!own.includes('TIER-RULE'), `the tier arrived twice:\n${own}`);
  } finally { w.restore(); }
});

// ---- 5b. the injection table: OpenCode plugin -----------------------------------------------------

const PLUGIN = new URL('../../adapters/opencode/plugins/geneseed-context.js', import.meta.url).href;
const stubClient = () => ({ session: { get: async () => ({ data: { title: 'user session' } }), messages: async () => [], prompt: async () => {} } });
const userMsg = (sid) => ({ info: { id: 'u1', role: 'user', sessionID: sid, time: { created: 2 } }, parts: [{ id: 'p1', type: 'text', text: 'hi' }] });

/** The block the plugin renders for a project repo; `global` plants a global OpenCode install's marker. */
async function pluginBlock(tag, { on, global }) {
  const d = sandbox(`gsst-p-${tag}-`);
  const repo = path.join(d, 'repo');
  const cfg = path.join(d, 'oc');
  const xdg = path.join(d, 'xdg');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(cfg, { recursive: true });
  fs.mkdirSync(path.join(xdg, 'geneseed'), { recursive: true });
  fs.writeFileSync(path.join(xdg, 'geneseed', 'user-rules.md'), 'TIER-RULE keep the plan visible\n');
  fs.writeFileSync(path.join(repo, 'README.md'), '# the project\n');
  if (global) fs.writeFileSync(path.join(cfg, '.geneseed-emit'), 'opencode-global\n');
  const saved = ['XDG_CONFIG_HOME', 'OPENCODE_CONFIG_DIR', 'GENESEED_HARNESS', 'GENESEED_WIKI'].map((v) => [v, process.env[v]]);
  process.env.XDG_CONFIG_HOME = xdg;
  process.env.OPENCODE_CONFIG_DIR = cfg;
  process.env.GENESEED_HARNESS = repo;
  delete process.env.GENESEED_WIKI;
  try {
    const argv = ['--emit', 'opencode', '--out', repo, '--theme', 'neutral'];
    if (on) argv.push('--shared-tier', 'on');
    assert.equal(build(...argv).value, 0);
    const mod = await import(`${PLUGIN}?case=${tag}`);
    const plugin = await mod.default.server({ directory: repo, client: stubClient() });
    const output = { messages: [userMsg('s1')] };
    await plugin['experimental.chat.messages.transform']({}, output);
    return output.messages[0].parts[0].text;
  } finally {
    for (const [v, val] of saved) { if (val === undefined) delete process.env[v]; else process.env[v] = val; }
  }
}

test('plugin: a project with the option on and no global install injects the tier', async () => {
  const text = await pluginBlock('on-alone', { on: true, global: false });
  assert.ok(text.includes(`${TIER_HEAD}\nTIER-RULE keep the plan visible`), text);
});

test('plugin: a project with the option on skips the tier when a global install exists, whose plugin injects it', async () => {
  const text = await pluginBlock('on-global', { on: true, global: true });
  assert.ok(!text.includes('TIER-RULE'), text);
});

test('plugin: a project with the option off injects no tier, with or without a global install', async () => {
  for (const global of [false, true]) {
    const text = await pluginBlock(`off-${global}`, { on: false, global });
    assert.ok(!text.includes('TIER-RULE'), text);
  }
});

test('plugin: a global install alone injects the tier', async () => {
  const d = sandbox('gsst-p-global-');
  const xdg = path.join(d, 'xdg');
  const h = path.join(d, 'harness');
  fs.mkdirSync(path.join(xdg, 'geneseed'), { recursive: true });
  fs.mkdirSync(h, { recursive: true });
  fs.writeFileSync(path.join(xdg, 'geneseed', 'user-rules.md'), 'TIER-RULE keep the plan visible\n');
  fs.writeFileSync(path.join(h, 'AGENT.md'), '# harness\n');
  fs.writeFileSync(path.join(h, '.geneseed-emit'), 'opencode-global\n');
  const saved = ['XDG_CONFIG_HOME', 'GENESEED_HARNESS', 'GENESEED_WIKI'].map((v) => [v, process.env[v]]);
  process.env.XDG_CONFIG_HOME = xdg;
  process.env.GENESEED_HARNESS = h;
  delete process.env.GENESEED_WIKI;
  try {
    const mod = await import(`${PLUGIN}?case=global-alone`);
    const plugin = await mod.default.server({ directory: h, client: stubClient() });
    const output = { messages: [userMsg('s1')] };
    await plugin['experimental.chat.messages.transform']({}, output);
    assert.ok(output.messages[0].parts[0].text.includes(`${TIER_HEAD}\nTIER-RULE`));
  } finally {
    for (const [v, val] of saved) { if (val === undefined) delete process.env[v]; else process.env[v] = val; }
  }
});

// ---- 6. one text for the trade --------------------------------------------------------------------

test('--help, the console and the docs quote the trade sentences cost.mjs writes', () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const table = JSON.parse(fs.readFileSync(path.join(root, 'js', 'cli-table.json'), 'utf8'));
  const opt = table.commands.find((c) => c.name === 'build').options.find((o) => o.names.includes('--shared-tier'));
  assert.ok(opt.help.includes(SHARED_TIER_BENEFIT) && opt.help.includes(sharedTierCost()), opt.help);
  const panel = fs.readFileSync(path.join(root, 'web', 'src', 'pages', 'Installs', 'InstallPanel.jsx'), 'utf8');
  const unquote = (s) => s.replace(/\\'/g, "'");
  assert.ok(unquote(panel).includes(SHARED_TIER_BENEFIT), 'the console lost the benefit sentence');
  assert.ok(unquote(panel).includes(sharedTierCost()), 'the console lost the cost sentence');
  const doc = fs.readFileSync(path.join(root, 'docs', 'concepts', 'rules.md'), 'utf8');
  assert.ok(doc.includes(`**Benefit:** ${SHARED_TIER_BENEFIT}`), 'the docs lost the benefit sentence');
  assert.ok(doc.includes(`**Cost:** ${sharedTierCost()}`), 'the docs lost the cost sentence');
});

// The sentence writes the budget out for people; the hook spends the constant. One can move alone.
test('the cost sentence names the budget the hook spends', () => {
  const spelled = String(OUTPUT_BUDGET).replace(/\B(?=(\d{3})+$)/g, ' ');
  assert.ok(sharedTierCost().includes(`fixed at ${spelled} characters`), sharedTierCost());
});

test('the token figure: characters over four, rounded to 100, with a space before the thousands; empty says null', () => {
  const d = sandbox('gsst-fig-');
  const prev = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = d;
  try {
    assert.equal(sharedTierFigure(), null);
    const tier = sharedPaths();
    fs.mkdirSync(tier.root, { recursive: true });
    fs.writeFileSync(tier.rules, 'x'.repeat(6000));
    assert.equal(sharedTierFigure(), '1 500');
    fs.writeFileSync(tier.rules, 'x'.repeat(1000));
    assert.equal(sharedTierFigure(), '300');
  } finally { if (prev === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = prev; }
});

// ---- 8. points carried into this slice ----------------------------------------------------------

/** Runs `fn` with these env vars set (undefined deletes), then restores them. */
function withEnv(env, fn) {
  const saved = Object.keys(env).map((k) => [k, process.env[k]]);
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally {
    for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('the console finds a tier that has rules and no memory folder', () => {
  const d = sandbox('gsst-cat-');
  const cfg = path.join(d, 'cfg');
  fs.mkdirSync(cfg);
  fs.writeFileSync(path.join(cfg, '.geneseed-emit'), 'claude-global\n');
  withEnv({ XDG_CONFIG_HOME: path.join(d, 'xdg') }, () => {
    const tier = sharedPaths();
    assert.equal(tierOf({ target: cfg }), null, 'no tier folder yet');
    fs.mkdirSync(tier.root, { recursive: true });
    fs.writeFileSync(tier.rules, 'TIER-RULE\n');
    assert.ok(!fs.existsSync(tier.memory));
    assert.equal(tierOf({ target: cfg })?.root, tier.root, 'a tier without memory/ dropped the console to the host seed');
    assert.equal(memoryDir({ target: cfg }), tier.memory);
  });
});

test('each session file the hook reads makes a tier, and what it does not read makes none', () => {
  // The hook reads every tier file that exists, so the console must edit that one. A row that is
  // not a session file stays no tier: it is what a 4.x machine holds.
  const rows = [['rules', true], ['profile', true], ['wiki', true], ['defaultInstall', false], ['foldState', false]];
  for (const [key, isTier] of rows) {
    const d = sandbox('gsst-arm-');
    const cfg = path.join(d, 'cfg');
    fs.mkdirSync(cfg);
    fs.writeFileSync(path.join(cfg, '.geneseed-emit'), 'claude-global\n');
    withEnv({ XDG_CONFIG_HOME: path.join(d, 'xdg') }, () => {
      const tier = sharedPaths();
      fs.mkdirSync(tier.root, { recursive: true });
      fs.writeFileSync(tier[key], 'x\n');
      assert.equal(tierOf({ target: cfg })?.root ?? null, isTier ? tier.root : null, key);
    });
  }
});

test('an agent lesson file that is not UTF-8 is left as it is; a sound one gains the bullet', () => {
  const d = sandbox('gsst-les-');
  const file = path.join(d, 'agents', 'reviewer.md');
  fs.mkdirSync(path.dirname(file));
  const bytes = Buffer.concat([Buffer.from('# reviewer lessons\n- 2026-01-01: caf'), Buffer.from([0xe9]), Buffer.from('\n')]);
  fs.writeFileSync(file, bytes);
  assert.equal(appendAgentLesson(d, 'reviewer', 'cite the test in every finding'), null);
  assert.ok(fs.readFileSync(file).equals(bytes), 'a byte was rewritten blind');
  fs.writeFileSync(file, '# reviewer lessons\n- 2026-01-01: kept\n');
  assert.equal(appendAgentLesson(d, 'reviewer', 'cite the test in every finding'), file);
  assert.match(fs.readFileSync(file, 'utf8'), /- 2026-01-01: kept\r?\n- \d{4}-\d{2}-\d{2}: cite the test in every finding\r?\n/);
});

test('the OpenCode learn plugin keeps the same rule for a lesson file that is not UTF-8', async () => {
  const { GeneseedLearn } = await import('../../adapters/opencode/plugins/geneseed-learn.js');
  const lesson = GeneseedLearn.appendAgentLesson;
  const d = sandbox('gsst-lesp-');
  fs.mkdirSync(path.join(d, 'agents'));
  const file = path.join(d, 'agents', 'tester.md');
  const bytes = Buffer.from([0x2d, 0x20, 0xff, 0x0a]);
  fs.writeFileSync(file, bytes);
  assert.equal(await lesson(d, 'tester', 'cite the test in every finding'), null);
  assert.ok(fs.readFileSync(file).equals(bytes));
});

test('exclude add moves a shared list that does not parse aside before it writes', () => {
  const d = sandbox('gsst-exc-');
  const cfg = path.join(d, 'cfg');
  const repo = path.join(d, 'repo');
  fs.mkdirSync(cfg); fs.mkdirSync(repo);
  fs.writeFileSync(path.join(cfg, GLOBAL_MANIFEST), '{}');
  withEnv({ XDG_CONFIG_HOME: path.join(d, 'xdg'), CLAUDE_CONFIG_DIR: cfg }, () => {
    const tier = sharedPaths();
    fs.mkdirSync(tier.root, { recursive: true });
    fs.writeFileSync(tier.excludes, '{ not json');
    assert.equal(capture(() => excludeAdd(repo)).value.ok, true);
    const aside = path.join(tier.root, 'archived-excludes.json');
    const kept = fs.readdirSync(aside).map((s) => fs.readFileSync(path.join(aside, s), 'utf8'));
    assert.deepEqual(kept, ['{ not json'], 'the torn file was not set aside whole');
    assert.equal(JSON.parse(fs.readFileSync(tier.excludes, 'utf8')).excludes.length, 1);
  });
});

test('a settings file the wiring cannot touch is reported, and the fold does not count it as wired', () => {
  const d = sandbox('gsst-wire-');
  const cfg = path.join(d, 'cfg');
  const repo = path.join(d, 'repo');
  fs.mkdirSync(cfg); fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(cfg, GLOBAL_MANIFEST), '{}');
  fs.writeFileSync(path.join(repo, '.claude', 'settings.local.json'), '// mine\n{}\n');
  withEnv({ XDG_CONFIG_HOME: path.join(d, 'xdg'), CLAUDE_CONFIG_DIR: cfg }, () => {
    const tier = sharedPaths();
    fs.mkdirSync(tier.root, { recursive: true });
    fs.writeFileSync(tier.excludes, JSON.stringify({ excludes: [{ path: repo.split(path.sep).join('/') }] }));
    const r = capture(() => foldExcludes('claude', cfg)).value;
    assert.equal(r.wired, 0, 'a bailed wiring was counted as wired');
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /claudeMdExcludes NOT wired in .*settings\.local\.json/);
    // The repo stays out of this host's list, so the next emit retries it.
    assert.ok(!fs.existsSync(path.join(cfg, 'excludes.json')) || !fs.readFileSync(path.join(cfg, 'excludes.json'), 'utf8').includes('repo'));
  });
});

// The console's measure answers as each host's own hook would, and a daemon keeps serving after
// it. Hand count: block title and blank 99; the 34-character shared head 36, the 31-character
// tier rule 33, a blank 2; the 37-character `host: bob` head 39, `mine` 6, a blank 2 = 217.
// Without the tier: 99, the 25-character plain head 27, 6, 2 = 134.
test('the session-start measure reads as the named host and leaves no host behind', () => {
  const w = world(false);
  try {
    fs.rmSync(path.join(w.repo, '.claude'), { recursive: true, force: true });
    fs.writeFileSync(path.join(w.gcfg, '.geneseed-emit'), 'bob-global\n');
    fs.writeFileSync(path.join(w.gcfg, 'user-rules.md'), 'mine\n');
    capture(() => cmdContext({ root: w.gcfg }));
    assert.deepEqual(sessionStartSize(w.gcfg, 'bob'), { chars: 217, budget: 9000, cut: false });
    assert.deepEqual(sessionStartSize(w.gcfg, 'openclaude'), { chars: 134, budget: 9000, cut: false });
    assert.deepEqual(sessionFiles(w.gcfg).map((s) => s.label), ['shared', 'host: claude']);
  } finally { w.restore(); }
});

test('a hook that names its host reads the tier only for a global of that host', () => {
  const w = world(false);
  try {
    fs.rmSync(path.join(w.repo, '.claude'), { recursive: true, force: true });
    fs.writeFileSync(path.join(w.gcfg, '.geneseed-emit'), 'bob-global\n');
    const names = (host) => capture(() => cmdContext({ root: w.gcfg, host })).out;
    assert.ok(names('bob').includes(TIER_HEAD), 'a bob hook on a bob global must read the tier');
    assert.ok(!names('claude').includes('TIER-RULE'), 'a claude hook on a bob global must not');
    assert.ok(capture(() => cmdContext({ root: w.gcfg })).out.includes(TIER_HEAD), 'a hook from before --host keeps reading any global');
  } finally { w.restore(); }
});

// The console reads a project's session files in-process, and must read the carrier of the install's
// own host, as that host's hook does: Bob's is AGENTS.md, OpenClaude's the nested .openclaude/CLAUDE.md.
// A marker in another host's root file opts nothing in. `on` is the file saying `Shared tier: on`, `off`
// a carrier without it. Hand count of `context`: the 31-character tier rule + `mine` = 35, `mine` alone 4.
const NESTED = path.join('.openclaude', 'CLAUDE.md');
const OWN_CARRIER = [
  { name: 'a Bob project opted in by AGENTS.md', host: 'bob', on: 'AGENTS.md', off: 'CLAUDE.md', tier: true },
  { name: 'a Bob project with the marker in CLAUDE.md only', host: 'bob', on: 'CLAUDE.md', off: 'AGENTS.md', tier: false },
  { name: 'an OpenClaude project opted in by its nested carrier', host: 'openclaude', on: NESTED, off: 'CLAUDE.md', tier: true },
  { name: 'an OpenClaude project with the marker in the root CLAUDE.md only', host: 'openclaude', on: 'CLAUDE.md', off: NESTED, tier: false },
];
for (const { name, host, on, off, tier } of OWN_CARRIER) {
  test(`the in-process read answers as the host's hook: ${name}`, () => {
    const w = world(false);
    try {
      fs.rmSync(w.pcfg, { recursive: true, force: true });
      const cfg = path.join(w.repo, `.${host}`);
      fs.mkdirSync(cfg, { recursive: true });
      fs.writeFileSync(path.join(cfg, 'user-rules.md'), 'mine\n');
      fs.writeFileSync(path.join(w.repo, on), 'Shared tier: on\n');
      fs.writeFileSync(path.join(w.repo, off), 'a carrier\n');
      assert.deepEqual(sessionFiles(cfg, host).map((s) => s.label), tier ? ['shared', `host: ${host}`] : ['']);
      assert.equal(alwaysOnCost({ host, root: w.repo, dir: cfg, footprint: 'full' }).context, tier ? 35 : 4);
      assert.equal(capture(() => cmdContext({ root: cfg, host })).out.includes(TIER_HEAD), tier);
    } finally { w.restore(); }
  });
}

// Claude's emitted hook names no host, so it reads any host's global: the console's figure for a
// claude row must take the same branch, not the stricter one `--host claude` would.
test('the always-on cost of a claude row reads the tier as its host-less hook does', () => {
  const w = world(false);
  try {
    fs.rmSync(w.pcfg, { recursive: true, force: true });
    fs.writeFileSync(path.join(w.gcfg, '.geneseed-emit'), 'bob-global\n');
    fs.writeFileSync(path.join(w.gcfg, 'CLAUDE.md'), 'a carrier\n');
    fs.writeFileSync(path.join(w.gcfg, 'user-rules.md'), 'mine\n');
    assert.ok(w.ctx(w.gcfg).includes(TIER_HEAD));
    assert.equal(alwaysOnCost({ host: 'claude', root: w.gcfg, dir: w.gcfg, footprint: 'full' }).context, 35);
  } finally { w.restore(); }
});
