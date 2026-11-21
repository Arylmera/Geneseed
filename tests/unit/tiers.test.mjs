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
//      `tierModel` returns the model AND a warning that says to pin it; only the doctor prints it.
//   5. With the option off or absent every emit is what it was. With it on, OpenCode (`model:
//      provider/model`) and OpenClaude route only the tiers the map names a model for: they have no
//      default (O12, 2026-11-18 D1). Bob's agents take no model line at all.
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
import { TIER_DEFAULTS, tierModel, loadAgentOverrides, loadTierMap, writeNativeLayer } from '../../js/hosts/native.mjs';
import { tierEnvNotes } from '../../js/inspect/checks-build.mjs';
import { tierMarkerProblem } from '../../js/inspect/checks-authoring.mjs';
import { statusData } from '../../js/inspect/status.mjs';
import { diffCollect } from '../../js/inspect/diff.mjs';
import { apiRestore } from '../../js/web/actions.mjs';
import { emitInto, webState } from '../helpers/web_api_fixture.mjs';
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
const LIGHT = ['explorer', 'researcher', 'skeptic', 'steward', 'user-advocate'];
// The seven seats of the opt-in council kit are light too, but only a build with the kit on emits them.
const KIT_LIGHT = ['advocate', 'empiricist', 'framer', 'historian', 'operator', 'pragmatist', 'visionary'];

test('the seats are the spec table: four strong, five light by default (twelve with the council kit), every other agent standard', () => {
  const items = renderAll(makeCfg(), 'neutral').items.filter((i) => /^agents\/[^_][^/]*\.md$/.test(i.rel));
  const tierOf = (name) => items.find((i) => i.rel === `agents/${name}.md`).tier ?? 'standard';
  assert.deepEqual(items.filter((i) => i.tier === 'strong').map((i) => path.basename(i.rel, '.md')).sort(), STRONG);
  assert.deepEqual(items.filter((i) => i.tier === 'light').map((i) => path.basename(i.rel, '.md')).sort(), LIGHT);
  for (const name of ['developer', 'crew-lead', 'tester', 'docs', 'memory-curator']) assert.equal(tierOf(name), 'standard', name);
  assert.ok(!items.some((i) => KIT_LIGHT.includes(path.basename(i.rel, '.md'))), 'a council-kit seat is in a default build');
  const kit = renderAll(makeCfg({ kits: ['council'] }), 'neutral').items.filter((i) => /^agents\/[^_][^/]*\.md$/.test(i.rel));
  assert.deepEqual(kit.filter((i) => i.tier === 'light').map((i) => path.basename(i.rel, '.md')).sort(),
    [...LIGHT, ...KIT_LIGHT].sort());
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
  test(`tierModel(${tier}, ${JSON.stringify(map)}, ${JSON.stringify(env)}) -> ${model ?? 'inherit'}`, () => {
    const r = tierModel(tier, map, env);
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
  assert.deepEqual(['explorer', 'researcher', 'skeptic'].map((a) => modelOf(dir, a)), ['haiku', 'haiku', 'haiku']);
  assert.deepEqual(STRONG.map((a) => modelOf(dir, a)), [null, null, null, null]);
});

test('with the option off an agent is its pre-marker text: the strip removes the marker line and nothing else', () => {
  // THE REAL SOURCES, not a null-against-undefined comparison. Byte identity with a build from before
  // the marker existed holds iff (1) stripping leaves each spec equal to the spec minus that one line,
  // and (2) that line sat on a blank-bounded boundary, directly above the heading, so no blank line
  // is lost or doubled. A marked spec is checked line by line; an unmarked one must come back as is.
  const dir = path.join(makeCfg().src, 'agents');
  let marked = 0;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.md') && !n.startsWith('_'))) {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    const lines = raw.split('\n');
    const at = lines.findIndex((l) => /^<!-- tier: (strong|light) -->$/.test(l));
    const { text, tier } = splitTier(raw);
    if (at < 0) {
      assert.equal(text, raw, `${f}: an unmarked spec changed`);
      assert.equal(tier, 'standard', f);
      continue;
    }
    marked += 1;
    assert.equal(text, lines.filter((_, i) => i !== at).join('\n'), `${f}: the strip removed more than the marker line`);
    // A blank line, or the seat's effort line (`effort.test.mjs`), which the build strips too.
    assert.ok(lines[at - 1] === '' || /^<!-- effort: (low|medium) -->$/.test(lines[at - 1]),
      `${f}: the marker must follow a blank line or the effort line`);
    assert.equal(lines[at + 1], '## When to dispatch', `${f}: the marker must sit directly above the heading`);
    assert.doesNotMatch(text, /<!--\s*tier:/, f);
  }
  assert.equal(marked, STRONG.length + LIGHT.length + KIT_LIGHT.length + 3, 'the marked seats are the spec table, the seven council-kit seats (their sources sit in src/agents) and the three other kit seats');
});

test('a tier marker anywhere but directly above "## When to dispatch" fails the authoring check', () => {
  const ok = '# a\n\n> d\n\n<!-- tier: light -->\n## When to dispatch\n- x\n';
  assert.equal(tierMarkerProblem(ok), '');
  assert.equal(tierMarkerProblem('# a\n\n> d\n\n## When to dispatch\n- x\n'), '', 'no marker: nothing to check');
  for (const [why, text, re] of [
    ['a blank line between marker and heading', ok.replace('-->\n', '-->\n\n'), /directly above/],
    ['inside the body', ok.replace('- x', '<!-- tier: light -->\n- x'), /more than one/],
    ['an unknown tier', ok.replace('light', 'heavy'), /not '<!-- tier: strong\|light -->'/],
    ['trailing text on the line', ok.replace('-->\n', '--> note\n'), /not '<!-- tier/],
    ['twice', ok.replace('<!-- tier: light -->', '<!-- tier: light -->\n<!-- tier: light -->'), /more than one/],
  ]) assert.match(tierMarkerProblem(text), re, why);
});

test('tiers off: no agent of a build carries a model line', () => {
  const base = emit({}, {}).dir;
  assert.deepEqual(fs.readdirSync(base).filter((f) => /^model: /m.test(read(base, f))), []);
});

test('Bob (bobDialect) writes no tier model, and OpenCode or OpenClaude with an empty map write none either (no default)', () => {
  const bob = emit({}, { tiers: tiers({ light: 'x/y' }), bobDialect: true }).dir;
  const oc = emit({}, { tiers: { ...tiers(), host: 'opencode' }, host: 'opencode' }).dir;
  const ocl = emit({}, { tiers: { ...tiers(), host: 'openclaude' } }).dir;
  for (const dir of [bob, oc, ocl]) {
    assert.deepEqual(fs.readdirSync(dir).filter((f) => /^model: /m.test(read(dir, f))), [], dir);
  }
});

test('OpenCode: a tier the map names writes provider/model (a V2 #variant verbatim); strong, a pin and an unnamed tier keep their rule', () => {
  const map = { standard: 'corp/mid#high', light: 'corp/fast' };
  const pins = { skeptic: { model: 'corp/pinned', variant: 'max' }, developer: { variant: 'low' } };
  const { dir } = emit(pins, { host: 'opencode', tiers: { map, env: {}, host: 'opencode' } });
  assert.equal(modelOf(dir, 'explorer'), 'corp/fast', 'light, mapped');
  assert.equal(modelOf(dir, 'tester'), 'corp/mid#high', 'standard, mapped, the #variant suffix is written as given');
  assert.equal(modelOf(dir, 'skeptic'), 'corp/pinned', 'a pin outranks the map');
  assert.equal(modelOf(dir, 'security'), null, 'strong inherits');
  // V1 keeps `variant` as its own key beside a tier model: the pin entry without a model still contributes it.
  assert.match(read(dir, 'developer.md'), /^model: corp\/mid#high\r?\nvariant: low\r?$/m);
  // Only light named: standard has no default on OpenCode, so it inherits.
  const half = emit({}, { host: 'opencode', tiers: { map: { light: 'corp/fast' }, env: {}, host: 'opencode' } }).dir;
  assert.equal(modelOf(half, 'explorer'), 'corp/fast');
  assert.equal(modelOf(half, 'tester'), null);
});

test('OpenClaude writes the mapped tier model through the Claude dialect, and sonnet/haiku are not defaults there', () => {
  const { dir } = emit({}, { tiers: { map: { light: 'corp-fast' }, env: {}, host: 'openclaude' } });
  assert.equal(modelOf(dir, 'explorer'), 'corp-fast');
  assert.equal(modelOf(dir, 'tester'), null, 'no default: the unmapped standard tier inherits');
});

test('the host default table is one table: Claude Code has two aliases, OpenCode and OpenClaude none', () => {
  assert.deepEqual(TIER_DEFAULTS, { claude: { standard: 'sonnet', light: 'haiku' }, opencode: {}, openclaude: {} });
  assert.equal(tierModel('light', {}, {}, 'opencode').model, null);
  assert.equal(tierModel('light', {}, {}, 'openclaude').model, null);
  assert.equal(tierModel('light', { light: 'haiku' }, BEDROCK, 'openclaude').warning, null, 'the cloud-alias advice is Claude Code only');
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

/** Where one emit's agents land, and where its agent-overrides.json is read (OpenCode: the project root). */
const emitPlace = (emitName, d) => ({
  agents: path.join(d, { opencode: '.opencode', bob: '.bob', openclaude: '.openclaude' }[emitName], 'agents'),
  overrides: path.join(d, emitName === 'openclaude' ? '.openclaude' : emitName === 'bob' ? '.bob' : '', 'agent-overrides.json'),
});
const withModels = (agents) => fs.readdirSync(agents).filter((f) => /^model: /m.test(read(agents, f)));
const MAP = { tiers: { light: 'corp/fast' } };

for (const emitName of ['opencode', 'openclaude', 'bob']) {
  // A populated tiers map is inert while the routing is off: every agent file carries no model line.
  test(`${emitName}: --tiers off with a populated tiers map writes no model line`, () => {
    const d = sandbox(`gst-off-map-${emitName}-`);
    const { agents, overrides } = emitPlace(emitName, d);
    fs.mkdirSync(path.dirname(overrides), { recursive: true });
    fs.writeFileSync(overrides, JSON.stringify(MAP));
    withEnv(NO_CLOUD, () => assert.equal(build('--emit', emitName, '--out', d, '--theme', 'neutral', '--tiers', 'off').value, 0));
    assert.deepEqual(withModels(agents), [], emitName);
  });
  // The same map with the routing on: OpenCode and OpenClaude route the light tier, Bob never writes a model.
  test(`${emitName}: --tiers auto with a tiers map ${emitName === 'bob' ? 'still writes no model line' : 'routes the light tier through a real build'}`, () => {
    const d = sandbox(`gst-auto-map-${emitName}-`);
    const { agents, overrides } = emitPlace(emitName, d);
    fs.mkdirSync(path.dirname(overrides), { recursive: true });
    fs.writeFileSync(overrides, JSON.stringify(MAP));
    withEnv(NO_CLOUD, () => assert.equal(build('--emit', emitName, '--out', d, '--theme', 'neutral', '--tiers', 'auto').value, 0));
    if (emitName === 'bob') { assert.deepEqual(withModels(agents), []); return; }
    assert.equal(modelOf(agents, 'explorer'), 'corp/fast');
    assert.equal(modelOf(agents, 'developer'), null, 'the unmapped standard tier has no default here');
    assert.equal(modelOf(agents, 'reviewer'), null);
  });
}

test('OpenClaude, Bob and OpenCode record the choice, and with no map none of them routes (no default)', () => {
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

// Earlier tests leave project installs in the sandboxed registry, and `installTargets` walks them too, so each
// assertion below reads the notes of ONE install: the global one by its prefix, a project by its folder.
const GLOBAL_NOTE = /\[tiers\] claude: /;
const BEDROCK_ENV = { CLAUDE_CODE_USE_BEDROCK: '1' };

test('the doctor names the alias variable an installed --tiers auto build is missing', () => {
  const dir = claudeConfigDir();
  try {
    withEnv(NO_CLOUD, () => assert.equal(build('--emit', 'claude-global', '--theme', 'neutral', '--tiers', 'auto').value, 0));
    assert.deepEqual(tierEnvNotes({}), [], 'a plain Anthropic environment is clean');
    const notes = tierEnvNotes(BEDROCK_ENV).filter((n) => GLOBAL_NOTE.test(n));
    assert.equal(notes.length, 2, notes.join('\n'));
    assert.match(notes[0], /\[tiers\] claude: --tiers auto: CLAUDE_CODE_USE_BEDROCK is set but ANTHROPIC_DEFAULT_SONNET_MODEL is not/);
    assert.match(notes[1], /ANTHROPIC_DEFAULT_HAIKU_MODEL/);
    assert.deepEqual(tierEnvNotes({ ...BEDROCK_ENV, ANTHROPIC_DEFAULT_SONNET_MODEL: 's',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'h' }), []);
    // An install built with tiers off has nothing to report.
    assert.equal(withEnv(NO_CLOUD, () => build('--emit', 'claude-global', '--theme', 'neutral', '--reset')).value, 0);
    assert.deepEqual(tierEnvNotes(BEDROCK_ENV).filter((n) => GLOBAL_NOTE.test(n)), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the doctor covers a project Claude install too, and skips a tier whose agents are all pinned', () => {
  const d = sandbox('gst-doc-proj-');
  withEnv(NO_CLOUD, () => assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral', '--tiers', 'auto').value, 0));
  const mine = (env) => tierEnvNotes(env).filter((n) => n.includes(`(project ${d})`));
  assert.deepEqual(mine({}), []);
  const both = mine(BEDROCK_ENV);
  assert.equal(both.length, 2, both.join('\n'));
  assert.match(both[0], /standard tier's 'sonnet' alias/);
  assert.match(both[1], /light tier's 'haiku' alias/);
  // Pin every standard agent (the project's overrides live in `.claude/`): no alias is in play for that tier.
  const pins = Object.fromEntries(['developer', 'crew-lead', 'tester', 'docs', 'memory-curator'].map((a) => [a, { model: 'opus' }]));
  fs.writeFileSync(path.join(d, '.claude', 'agent-overrides.json'), JSON.stringify({ agents: pins }));
  const light = mine(BEDROCK_ENV);
  assert.equal(light.length, 1, light.join('\n'));
  assert.match(light[0], /light tier/);
  // One standard agent unpinned: the tier is back.
  delete pins.docs;
  fs.writeFileSync(path.join(d, '.claude', 'agent-overrides.json'), JSON.stringify({ agents: pins }));
  assert.equal(mine(BEDROCK_ENV).length, 2);
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

// ---- 9. diff and restore render what the install is --------------------------------------------------
// `expected` is rendered into a temp config dir. It must carry the install's tier routing (the carrier
// line and the model lines) AND the user's own `agent-overrides.json` (the tiers map and the pins), or
// the diff reports every one of them as drift and a restore writes the default over a chosen model.

test('diff reports no drift for a --tiers auto install with a tiers map and a pin, and restore keeps them', () => {
  const cfg = sandbox('gst-diff-');
  fs.writeFileSync(path.join(cfg, 'agent-overrides.json'),
    JSON.stringify({ agents: { skeptic: { model: 'opus' } }, tiers: { light: 'claude-haiku-4-5' } }));
  withEnv(NO_CLOUD, () => assert.equal(build('--emit', 'claude-global', '--theme', 'neutral', '--config-dir', cfg,
    '--tiers', 'auto').value, 0));
  const agents = path.join(cfg, 'agents');
  assert.equal(modelOf(agents, 'explorer'), 'claude-haiku-4-5', 'the fixture did not route through the map');
  assert.equal(modelOf(agents, 'skeptic'), 'opus');
  const drift = () => diffCollect({ target: cfg }).files.map((f) => f.rel).filter((r) => r !== 'agent-overrides.json');
  assert.deepEqual(drift(), [], 'a map-driven or pinned model line was reported as drift');
  // A real edit is still found, and restoring it keeps the routing: the models the map and the pin chose.
  const explorer = path.join(agents, 'explorer.md');
  fs.writeFileSync(explorer, `${read(explorer)}\nLOCAL EDIT\n`);
  assert.deepEqual(drift(), ['agents/explorer.md']);
  const st = webState('neutral', cfg);
  st.selectView(cfg, null, 'claude-global');
  const res = apiRestore(st, ['agents/explorer.md']);
  assert.deepEqual(res.errors, []);
  assert.doesNotMatch(read(explorer), /LOCAL EDIT/);
  assert.equal(modelOf(agents, 'explorer'), 'claude-haiku-4-5', 'a restore wrote the default model over the map\'s');
  assert.deepEqual(drift(), []);
});

for (const [emitName, model] of [['opencode-global', 'corp/fast'], ['openclaude-global', 'corp-fast']]) {
  test(`diff reports no drift for a ${emitName} --tiers auto install with a tiers map and a pin, and restore keeps them`, () => {
    const cfg = sandbox('gst-diff-');
    fs.writeFileSync(path.join(cfg, 'agent-overrides.json'),
      JSON.stringify({ agents: { skeptic: { model: `${model}-pin` } }, tiers: { light: model } }));
    assert.equal(build('--emit', emitName, '--theme', 'neutral', '--config-dir', cfg, '--tiers', 'auto').value, 0);
    const agents = path.join(cfg, 'agents');
    assert.equal(modelOf(agents, 'explorer'), model, 'the fixture did not route through the map');
    assert.equal(modelOf(agents, 'skeptic'), `${model}-pin`);
    const drift = () => diffCollect({ target: cfg }).files.map((f) => f.rel).filter((r) => r !== 'agent-overrides.json');
    assert.deepEqual(drift(), [], 'a routed model line was reported as drift');
    const explorer = path.join(agents, 'explorer.md');
    fs.writeFileSync(explorer, `${read(explorer)}\nLOCAL EDIT\n`);
    assert.deepEqual(drift(), ['agents/explorer.md']);
    const st = webState('neutral', cfg);
    st.selectView(cfg, null, emitName);
    assert.deepEqual(apiRestore(st, ['agents/explorer.md']).errors, []);
    assert.equal(modelOf(agents, 'explorer'), model, 'a restore dropped the routed model');
    assert.deepEqual(drift(), []);
  });
}

test('restore keeps the carrier\'s routing line (an OpenCode install built --tiers auto)', () => {
  const sb = makeSandbox();
  try {
    const cfg = emitInto(path.join(sb.path, 'cfg'), { extra: ['--tiers', 'auto'] });
    const agent = path.join(cfg, 'AGENT.md');
    assert.match(read(agent), /^Model tiers: auto$/m, 'the fixture did not record the routing');
    fs.writeFileSync(agent, `${read(agent)}\nLOCAL EDIT\n`);
    const res = apiRestore(webState('neutral', cfg), ['AGENT.md']);
    assert.deepEqual(res.errors, []);
    assert.doesNotMatch(read(agent), /LOCAL EDIT/);
    assert.match(read(agent), /^Model tiers: auto$/m, 'a restore rendered expected with the routing off');
  } finally { sb.cleanup(); }
});

