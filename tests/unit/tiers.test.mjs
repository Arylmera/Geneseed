// `--tiers auto|off` — sub-agent model tiers (spec docs/specs/2026-11-17-subagent-model-tiers.md).
//
// Written out, not recorded. The rules this file holds:
//   1. An agent source names its tier on a line of its own, `<!-- tier: strong|light -->`; no
//      line is `standard`. The seat table below is the spec's, plus the kit judgement seats (react-reviewer,
//      spring-reviewer, spring-security: strong, user decision Q9). The line is stripped from every
//      output, and stripping it leaves the text a build rendered before the marker existed.
//   2. The model of a Claude Code agent follows one precedence, highest first: the user's pin
//      (`agents.<name>.model`) > the `tiers` map > the tier's default alias > inherit (no line).
//      `strong` has no default and no map key: it is the parent's model, unless pinned.
//   3. Defaults: standard -> `sonnet`, light -> `haiku`. A map key names another model; an empty
//      value means inherit.
//   4. D11 (revised): the alias is always written. On Bedrock or Vertex without ANTHROPIC_DEFAULT_<ALIAS>_MODEL
//      Claude Code falls back to its built-in model id, which may not exist in the user's project, so
//      `claudeTierModel` returns the model AND a warning that says to pin it; only the doctor prints it.
//   5. With the option off or absent every emit is what it was; OpenClaude, Bob and OpenCode
//      write no tier model (B6, D8, and the OpenCode resolver is not built yet).
//   6. The choice is recorded in the carrier (`Model tiers: auto`, only off the default), read
//      back by `tiersOfDir`, kept by the rebuild argv, and held by the preserve guard.
//   7. The doctor names the missing alias variable of an installed `--tiers auto` build.
// If a rule below is wrong, change the row AND the sentence above it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';

import { renderAll } from '../../js/build/render.mjs';
import { main as driverMain } from '../../js/build/driver.mjs';
import { installProfile, setupBuildArgs } from '../../js/build/generate.mjs';
import { makeCfg, splitTier } from '../../js/build/source.mjs';
import { claudeConfigDir } from '../../js/hosts/hosts.mjs';
import { tiersOfDir } from '../../js/hosts/installs.mjs';
import { claudeTierModel, loadAgentOverrides, loadTierMap, writeNativeLayer } from '../../js/hosts/native.mjs';
import { tierEnvNotes } from '../../js/inspect/checks-build.mjs';
import { statusData } from '../../js/inspect/status.mjs';
import { installedDefaults } from '../../js/hosts/installs.mjs';
import {
  loadProfile, profileBuildArgs, profileDiff, profileFromInstall, profileProblems,
} from '../../js/maintain/profiles.mjs';
import { targetTiers } from '../../js/maintain/setup.mjs';
import { makeSandbox, restoreProcessHome, sandboxProcessHome } from '../helpers/sandbox.mjs';

// FIRST: every emit writes the hook shim and the registry into the environment's home.
sandboxProcessHome();
const sandboxes = [];
after(() => { for (const sb of sandboxes) sb.cleanup(); restoreProcessHome(); });
const sandbox = (prefix) => { const sb = makeSandbox(prefix); sandboxes.push(sb); return sb.path; };

function capture(fn) {
  const o = process.stdout.write; const e = process.stderr.write;
  let out = ''; let err = '';
  process.stdout.write = (s) => { out += String(s); return true; };
  process.stderr.write = (s) => { err += String(s); return true; };
  try { return { value: fn(), out, err }; } finally { process.stdout.write = o; process.stderr.write = e; }
}
const build = (...argv) => capture(() => driverMain(argv));
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
/** The `model:` value of an emitted agent, or null when it has none. */
const modelOf = (dir, agent) => /^model: (.+)$/m.exec(read(dir, `${agent}.md`))?.[1] ?? null;

/** Run `fn` with env vars set (null deletes), restored after. */
function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === null) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const NO_CLOUD = { CLAUDE_CODE_USE_BEDROCK: null, CLAUDE_CODE_USE_VERTEX: null,
  ANTHROPIC_DEFAULT_SONNET_MODEL: null, ANTHROPIC_DEFAULT_HAIKU_MODEL: null, ANTHROPIC_DEFAULT_OPUS_MODEL: null };

// ---- 1. the marker and the seats -------------------------------------------------------------------

const STRONG = ['architect', 'performance', 'reviewer', 'security'];
const LIGHT = ['advocate', 'empiricist', 'explorer', 'framer', 'historian', 'operator', 'pragmatist',
  'researcher', 'skeptic', 'steward', 'user-advocate', 'visionary'];

test('the seats are the spec table: four strong, twelve light, every other agent standard', () => {
  const items = renderAll(makeCfg(), 'neutral').items.filter((i) => /^agents\/[^_][^/]*\.md$/.test(i.rel));
  const tierOf = (name) => items.find((i) => i.rel === `agents/${name}.md`).tier ?? 'standard';
  assert.deepEqual(items.filter((i) => i.tier === 'strong').map((i) => path.basename(i.rel, '.md')).sort(), STRONG);
  assert.deepEqual(items.filter((i) => i.tier === 'light').map((i) => path.basename(i.rel, '.md')).sort(), LIGHT);
  for (const name of ['developer', 'tester', 'docs', 'memory-curator']) assert.equal(tierOf(name), 'standard', name);
});

test('the kit seats react-reviewer, spring-reviewer and spring-security are strong, like the core judgement seats', () => {
  // Only rendered with their kits on, so the default table above does not see them.
  const items = renderAll(makeCfg({ kits: ['react', 'spring-boot'] }), 'neutral').items;
  const tier = (n) => items.find((i) => i.rel === `agents/${n}.md`)?.tier;
  for (const n of ['react-reviewer', 'spring-reviewer', 'spring-security']) assert.equal(tier(n), 'strong', n);
  // And the other kit agents stay standard.
  for (const n of ['react-engineer', 'spring-boot-engineer']) assert.equal(tier(n), 'standard', n);
});

test('no rendered agent carries the tier line', () => {
  for (const { rel, text } of renderAll(makeCfg(), 'neutral').items) {
    if (text !== null && rel.startsWith('agents/') && !rel.startsWith('agents/_')) assert.doesNotMatch(text, /<!--\s*tier:/, rel);
  }
});

test('splitTier removes the whole line and nothing else; a quoted marker declares nothing', () => {
  const body = '# a\n\n> d\n\n<!-- tier: light -->\n## When to dispatch\n- x\n';
  assert.deepEqual(splitTier(body), { text: '# a\n\n> d\n\n## When to dispatch\n- x\n', tier: 'light' });
  assert.deepEqual(splitTier('x\r\n<!-- tier: strong -->\r\ny\r\n'), { text: 'x\r\ny\r\n', tier: 'strong' });
  // Mid-line, in a code span, or naming no known tier: not a marker.
  for (const quoted of ['use `<!-- tier: light -->` here\n', 'a <!-- tier: light --> b\n', '<!-- tier: heavy -->\n']) {
    assert.deepEqual(splitTier(quoted), { text: quoted, tier: 'standard' }, quoted);
  }
});

// ---- 2-4. the model a tier resolves to -------------------------------------------------------------

const BEDROCK = { CLAUDE_CODE_USE_BEDROCK: '1' };
const rows = [
  // [tier, map, env, model, warns the variable]
  ['strong', {}, {}, null, null],
  ['strong', { standard: 'opus', light: 'opus' }, {}, null, null],          // strong takes no value
  ['standard', {}, {}, 'sonnet', null],
  ['light', {}, {}, 'haiku', null],
  ['standard', { standard: 'opus' }, {}, 'opus', null],                     // the map renames the model
  ['light', { light: 'claude-haiku-4-5' }, {}, 'claude-haiku-4-5', null],
  ['light', { light: '' }, {}, null, null],                                 // empty: the user chose inherit
  ['light', { standard: 'opus' }, {}, 'haiku', null],                       // a key for another tier is not ours
  ['unmarked', {}, {}, null, null],                                         // not a tier at all
  // D11 — a cloud provider without the alias variable: the alias stays, and the warning names the variable.
  ['standard', {}, BEDROCK, 'sonnet', 'ANTHROPIC_DEFAULT_SONNET_MODEL'],
  ['light', {}, BEDROCK, 'haiku', 'ANTHROPIC_DEFAULT_HAIKU_MODEL'],
  ['light', {}, { CLAUDE_CODE_USE_VERTEX: 'true' }, 'haiku', 'ANTHROPIC_DEFAULT_HAIKU_MODEL'],
  ['standard', { standard: 'opus' }, BEDROCK, 'opus', 'ANTHROPIC_DEFAULT_OPUS_MODEL'],
  // ... with the variable set, or the provider switch spelled off, or a model id the user wrote.
  ['standard', {}, { ...BEDROCK, ANTHROPIC_DEFAULT_SONNET_MODEL: 'us.anthropic.x' }, 'sonnet', null],
  ['light', {}, { CLAUDE_CODE_USE_BEDROCK: '0' }, 'haiku', null],
  ['light', {}, { CLAUDE_CODE_USE_BEDROCK: 'false' }, 'haiku', null],
  ['light', { light: 'us.anthropic.claude-haiku-4-5' }, BEDROCK, 'us.anthropic.claude-haiku-4-5', null],
  ['strong', {}, BEDROCK, null, null],                                      // inherit needs no alias
];
for (const [tier, map, env, model, variable] of rows) {
  test(`claudeTierModel(${tier}, ${JSON.stringify(map)}, ${JSON.stringify(env)}) -> ${model ?? 'inherit'}`, () => {
    const r = claudeTierModel(tier, map, env);
    assert.equal(r.model, model);
    if (variable) assert.ok(r.warning?.includes(variable), `warning does not name ${variable}: ${r.warning}`);
    else assert.equal(r.warning, null);
  });
}

// ---- 2. precedence through the writer ----------------------------------------------------------------

const itemsOf = () => renderAll(makeCfg(), 'neutral').items;
/** Emit the agents of one dialect into a fresh dir; `overrides` is what `loadAgentOverrides` returns. */
function emit(overrides, opts) {
  const d = sandbox('gst-w-');
  const r = capture(() => writeNativeLayer(itemsOf(), path.join(d, 'agents'), path.join(d, 'skills'),
    overrides, { src: makeCfg().src, host: 'claude', ...opts }));
  return { dir: path.join(d, 'agents'), err: r.err };
}
const tiers = (map = {}, env = {}) => ({ map, env });

test('pin > map > default > inherit, row by row', () => {
  const pins = { explorer: { model: 'opus' }, tester: { model: 'haiku' }, reviewer: { model: 'sonnet' } };
  const { dir } = emit(pins, { tiers: tiers({ standard: 'claude-x' }) });
  assert.equal(modelOf(dir, 'explorer'), 'opus', 'a pin outranks the light default');
  assert.equal(modelOf(dir, 'tester'), 'haiku', 'a pin outranks the map');
  assert.equal(modelOf(dir, 'reviewer'), 'sonnet', 'a pin may give a strong seat a model');
  assert.equal(modelOf(dir, 'developer'), 'claude-x', 'the map outranks the default');
  assert.equal(modelOf(dir, 'skeptic'), 'haiku', 'a light seat, no pin, no map key: the default');
  assert.equal(modelOf(dir, 'security'), null, 'a strong seat with no pin inherits');
});

test('defaults with an empty map: standard sonnet, light haiku, strong none', () => {
  const { dir } = emit({}, { tiers: tiers() });
  assert.deepEqual(['developer', 'tester', 'docs', 'memory-curator'].map((a) => modelOf(dir, a)),
    ['sonnet', 'sonnet', 'sonnet', 'sonnet']);
  assert.deepEqual(['explorer', 'researcher', 'historian'].map((a) => modelOf(dir, a)), ['haiku', 'haiku', 'haiku']);
  assert.deepEqual(STRONG.map((a) => modelOf(dir, a)), [null, null, null, null]);
});

test('tiers off or absent: every agent file is the one an emit without the option writes', () => {
  const base = emit({}, {}).dir;
  const off = emit({}, { tiers: null }).dir;
  for (const f of fs.readdirSync(base)) assert.equal(read(off, f), read(base, f), f);
  assert.deepEqual(fs.readdirSync(base).filter((f) => /^model: /m.test(read(base, f))), []);
});

test('OpenClaude and Bob (bobDialect) and OpenCode write no tier model', () => {
  const bob = emit({}, { tiers: tiers(), bobDialect: true }).dir;
  const oc = emit({}, { tiers: tiers(), host: 'opencode' }).dir;
  for (const dir of [bob, oc]) {
    assert.deepEqual(fs.readdirSync(dir).filter((f) => /^model: /m.test(read(dir, f))), [], dir);
  }
});

test('D11 through the writer: a cloud provider changes no line and the build says nothing', () => {
  const plain = emit({}, { tiers: tiers() });
  const { dir, err } = emit({}, { tiers: tiers({}, BEDROCK) });
  for (const f of fs.readdirSync(plain.dir)) assert.equal(read(dir, f), read(plain.dir, f), f);
  assert.equal(modelOf(dir, 'explorer'), 'haiku');
  assert.equal(modelOf(dir, 'developer'), 'sonnet');
  assert.doesNotMatch(err, /ANTHROPIC_DEFAULT/);
});

// ---- 3. the tiers map in agent-overrides.json ------------------------------------------------------

test('loadTierMap keeps standard and light, drops strong, unknown keys and values that break a line', () => {
  const d = sandbox('gst-map-');
  fs.writeFileSync(path.join(d, 'agent-overrides.json'), JSON.stringify({
    agents: { reviewer: { model: 'x' } },
    tiers: { standard: 'opus', light: 'bad\nmodel: y', strong: 'opus', mid: 'x', },
  }));
  const seen = [];
  assert.deepEqual(loadTierMap(d, (l) => seen.push(l)), { standard: 'opus' });
  assert.equal(seen.length, 3, seen.join('\n'));
  assert.ok(seen.some((l) => l.includes('tiers.light') && l.includes('line break')));
  assert.ok(seen.some((l) => l.includes('tiers.strong')));
  assert.ok(seen.some((l) => l.includes('tiers.mid')));
  // The agents reader is untouched by the new key.
  assert.deepEqual(loadAgentOverrides(d), { reviewer: { model: 'x' } });
  // No file, malformed file, no `tiers` key: every tier on its default.
  assert.deepEqual(loadTierMap(sandbox('gst-none-')), {});
  fs.writeFileSync(path.join(d, 'agent-overrides.json'), '{ not json');
  assert.deepEqual(loadTierMap(d), {});
});

// ---- 5-6. the build option ------------------------------------------------------------------------

test('the flag takes auto or off, and refuses anything else by name', () => {
  const r = build('--emit', 'claude', '--out', sandbox('gst-bad-'), '--tiers', 'on');
  assert.equal(r.value, 2);
  assert.match(r.err, /argument --tiers: invalid choice: 'on' \(choose from 'auto', 'off'\)/);
});

test('a claude project emit with --tiers auto routes the agents and marks the carrier', () => {
  const d = sandbox('gst-auto-');
  withEnv(NO_CLOUD, () => assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral', '--tiers', 'auto').value, 0));
  const agents = path.join(d, '.claude', 'agents');
  assert.equal(modelOf(agents, 'explorer'), 'haiku');
  assert.equal(modelOf(agents, 'developer'), 'sonnet');
  assert.equal(modelOf(agents, 'reviewer'), null);
  assert.match(read(d, 'CLAUDE.md'), /^Model tiers: auto$/m);
  assert.equal(tiersOfDir(d, 'claude'), 'auto');
  assert.doesNotMatch(read(agents, 'explorer.md'), /tier:/);
});

test('a default emit writes no marker and no model; the install reads back off', () => {
  const d = sandbox('gst-off-');
  assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral').value, 0);
  assert.doesNotMatch(read(d, 'CLAUDE.md'), /^Model tiers:/m);
  assert.equal(tiersOfDir(d, 'claude'), 'off');
  assert.equal(modelOf(path.join(d, '.claude', 'agents'), 'explorer'), null);
});

test('a hand-edited marker value reads as off, so it can never reach --tiers', () => {
  const d = sandbox('gst-edit-');
  withEnv(NO_CLOUD, () => build('--emit', 'claude', '--out', d, '--theme', 'neutral', '--tiers', 'auto'));
  fs.writeFileSync(path.join(d, 'CLAUDE.md'), read(d, 'CLAUDE.md').replace('Model tiers: auto', 'Model tiers: max'));
  assert.equal(tiersOfDir(d, 'claude'), 'off');
});

test('OpenClaude, Bob and OpenCode record the choice and route nothing', () => {
  for (const emitName of ['openclaude', 'bob', 'opencode']) {
    const d = sandbox(`gst-${emitName}-`);
    withEnv(NO_CLOUD, () => assert.equal(build('--emit', emitName, '--out', d, '--theme', 'neutral', '--tiers', 'auto').value, 0));
    const agents = ['openclaude', 'bob'].includes(emitName) ? path.join(d, emitName === 'bob' ? '.bob' : '.openclaude', 'agents')
      : path.join(d, '.opencode', 'agents');
    assert.deepEqual(fs.readdirSync(agents).filter((f) => /^model: /m.test(read(agents, f))), [], emitName);
    assert.equal(tiersOfDir(d, emitName), 'auto', emitName);
  }
});

test('D11 through a build: a Bedrock environment without the variables still writes the aliases', () => {
  const d = sandbox('gst-bedrock-');
  const r = withEnv({ ...NO_CLOUD, CLAUDE_CODE_USE_BEDROCK: '1' },
    () => build('--emit', 'claude', '--out', d, '--theme', 'neutral', '--tiers', 'auto'));
  assert.equal(r.value, 0, r.err);
  assert.doesNotMatch(r.err, /ANTHROPIC_DEFAULT/);
  assert.equal(modelOf(path.join(d, '.claude', 'agents'), 'explorer'), 'haiku');
  assert.equal(modelOf(path.join(d, '.claude', 'agents'), 'developer'), 'sonnet');
});

test('the map and a pin in agent-overrides.json reach a real build; the pin wins', () => {
  const d = sandbox('gst-map-build-');
  fs.mkdirSync(path.join(d, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(d, '.claude', 'agent-overrides.json'),
    JSON.stringify({ agents: { skeptic: { model: 'opus' } }, tiers: { light: 'claude-haiku-4-5' } }));
  withEnv(NO_CLOUD, () => assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral', '--tiers', 'auto').value, 0));
  const agents = path.join(d, '.claude', 'agents');
  assert.equal(modelOf(agents, 'explorer'), 'claude-haiku-4-5');
  assert.equal(modelOf(agents, 'skeptic'), 'opus');
});

test('the rebuild argv keeps --tiers auto, elides off, and the preserve guard holds it', () => {
  const d = sandbox('gst-argv-');
  withEnv(NO_CLOUD, () => build('--emit', 'claude', '--out', d, '--theme', 'neutral', '--tiers', 'auto'));
  const p = installProfile('claude', 'project', d);
  assert.equal(p.tiers, 'auto');
  assert.deepEqual(p.argv.slice(-2), ['--tiers', 'auto']);
  const refused = build('--emit', 'claude', '--out', d, '--theme', 'neutral');
  assert.equal(refused.value, 1);
  assert.match(refused.err, /tiers: auto -> off/);
  assert.match(refused.err, /--tiers auto/);
  // Replaying the profile's own argv runs unchanged.
  assert.equal(withEnv(NO_CLOUD, () => build(...p.argv)).value, 0);
  // `setupBuildArgs` spells it last, and only off the default.
  const base = ['t', 'claude', null, null, 'lean', 'peer', 'direct'];
  assert.ok(!setupBuildArgs(...base).includes('--tiers'));
  assert.ok(!setupBuildArgs(...base, null, undefined, null, 'x', null, [], null, false, '200k', 'off').includes('--tiers'));
  assert.deepEqual(setupBuildArgs(...base, null, undefined, null, 'x', null, [], null, false, '200k', 'auto').slice(-2),
    ['--tiers', 'auto']);
});

test('--reset returns an install to off', () => {
  const d = sandbox('gst-reset-');
  withEnv(NO_CLOUD, () => build('--emit', 'claude', '--out', d, '--theme', 'neutral', '--tiers', 'auto'));
  assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral', '--reset').value, 0);
  assert.equal(tiersOfDir(d, 'claude'), 'off');
  assert.equal(modelOf(path.join(d, '.claude', 'agents'), 'explorer'), null);
});

// ---- 7. the doctor ---------------------------------------------------------------------------------

test('the doctor names the alias variable an installed --tiers auto build is missing', () => {
  const dir = claudeConfigDir();
  try {
    withEnv(NO_CLOUD, () => assert.equal(build('--emit', 'claude-global', '--theme', 'neutral', '--tiers', 'auto').value, 0));
    assert.deepEqual(tierEnvNotes({}), [], 'a plain Anthropic environment is clean');
    const notes = tierEnvNotes({ CLAUDE_CODE_USE_BEDROCK: '1' });
    assert.equal(notes.length, 2, notes.join('\n'));
    assert.match(notes[0], /\[tiers\] claude: --tiers auto: CLAUDE_CODE_USE_BEDROCK is set but ANTHROPIC_DEFAULT_SONNET_MODEL is not/);
    assert.match(notes[1], /ANTHROPIC_DEFAULT_HAIKU_MODEL/);
    assert.deepEqual(tierEnvNotes({ CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_DEFAULT_SONNET_MODEL: 's',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'h' }), []);
    // An install built with tiers off has nothing to report.
    assert.equal(withEnv(NO_CLOUD, () => build('--emit', 'claude-global', '--theme', 'neutral', '--reset')).value, 0);
    assert.deepEqual(tierEnvNotes({ CLAUDE_CODE_USE_BEDROCK: '1' }), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- 8. the settings that carry it forward ----------------------------------------------------------
// A `--reset` rebuild is a WHOLE selection, and `setupBuildArgs` elides `off`, so a path that never
// heard of the option would put an `auto` install back to off. Each path below reads the install's own
// value, and only a caller who names one changes it.

const STARTER = () => loadProfile('starter').profile;
const tiersFlag = (argv) => (argv.includes('--tiers') ? argv[argv.indexOf('--tiers') + 1] : null);

test('profileBuildArgs: the profile key wins, else the install value, else off; --reset stays last', () => {
  const p = STARTER();
  assert.equal(p.tiers, undefined, 'a shipped profile must not turn the routing on');
  for (const [profileTiers, current, want] of [
    [undefined, 'auto', 'auto'],   // a profile that says nothing keeps the install's routing
    [undefined, 'off', null],
    [undefined, null, null],       // no install yet: off
    ['off', 'auto', null],         // a profile that names off turns it off
    ['auto', 'off', 'auto'],       // and one that names auto turns it on
    ['auto', null, 'auto'],
  ]) {
    const argv = profileBuildArgs({ ...p, ...(profileTiers ? { tiers: profileTiers } : {}) }, 'claude', null, current);
    assert.equal(tiersFlag(argv), want, `${profileTiers} over ${current}`);
    assert.equal(argv.at(-1), '--reset');
  }
});

test('a profile validates its tiers key, saves it only when on, and diffs it', () => {
  assert.deepEqual(profileProblems({ ...STARTER(), tiers: 'auto' }), []);
  assert.deepEqual(profileProblems({ ...STARTER(), tiers: 'on' }), ["'tiers': invalid value 'on' (valid: 'auto', 'off')"]);
  const info = { ...installProfile('claude', 'project', sandbox('gst-prof-')), tiers: 'auto' };
  assert.equal(profileFromInstall(info).tiers, 'auto');
  assert.ok(!('tiers' in profileFromInstall({ ...info, tiers: 'off' })));
  assert.deepEqual(profileDiff({ ...STARTER(), tiers: 'auto' }, STARTER()).find((d) => d.key === 'tiers'),
    { key: 'tiers', base: 'off', now: 'auto' });
});

test('the wizard keeps the target install\'s routing and asks nothing', () => {
  const d = sandbox('gst-wiz-');
  assert.equal(targetTiers('claude', d), 'off', 'no install: off');
  withEnv(NO_CLOUD, () => build('--emit', 'claude', '--out', d, '--theme', 'neutral', '--tiers', 'auto'));
  assert.equal(targetTiers('claude', d), 'auto');
  assert.equal(targetTiers('files', d), 'off');
});

test('status shows the routing, and the wizard walk reads it off an installed machine', () => {
  const dir = claudeConfigDir();
  try {
    assert.equal(installedDefaults().tiers, 'off');
    withEnv(NO_CLOUD, () => assert.equal(build('--emit', 'claude-global', '--theme', 'neutral', '--tiers', 'auto').value, 0));
    assert.equal(installedDefaults().tiers, 'auto');
    const row = statusData().installs.find((p) => p.host === 'claude' && p.scope === 'global');
    assert.equal(row.tiers, 'auto');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
