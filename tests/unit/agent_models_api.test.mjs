// The console's sub-agent models — `GET`/`POST /api/agent-models` (js/web/agent-models-api.mjs).
//
// Written out, not recorded. The rules this file holds:
//   1. ONE PRECEDENCE, ONE HOME: an agent's model is the user's pin, else the `tiers` map (a key
//      the map names, an empty value included, beats the default), else the tier's default alias,
//      else inherit (`claudeAgentModel`). With the routing off only a pin counts. A pinned agent
//      carries no Bedrock/Vertex warning: the tier gave it nothing.
//   2. The page and the build agree: the model the API reports for an agent is the `model:` line
//      the next emit writes into that agent (cross-checked against a real emit below).
//   3. A write edits the keys it names and nothing else. A tier value is a string (`''` = inherit)
//      or null (remove the key: back to the default); a pin is a string, or ''/null to remove ONLY
//      `model` from the agent's entry. A value that breaks the frontmatter, an unknown tier
//      (`strong` takes no model), an agent the install lacks, or a `tiers`/`agents` that is not an
//      object is refused, and then nothing is applied.
//   4. A file that does not parse is never rewritten: the save is refused and the bytes stay.
//   5. Models are Claude Code's: another host answers each agent's tier and no model, and refuses a save.
// If a rule below is wrong, change the row AND the sentence above it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';

import { main as driverMain } from '../../js/build/driver.mjs';
import { claudeAgentModel, loadTierMap } from '../../js/hosts/native.mjs';
import { agentTiers, apiAgentModels, apiAgentModelsSave, editOverrides } from '../../js/web/agent-models-api.mjs';
import { webState } from '../helpers/web_api_fixture.mjs';
import { makeSandbox, restoreProcessHome, sandboxProcessHome } from '../helpers/sandbox.mjs';

sandboxProcessHome();
const sandboxes = [];
after(() => { for (const sb of sandboxes) sb.cleanup(); restoreProcessHome(); });
const sandbox = (prefix) => { const sb = makeSandbox(prefix); sandboxes.push(sb); return sb.path; };

function quiet(fn) {
  const o = process.stdout.write; const e = process.stderr.write;
  process.stdout.write = () => true; process.stderr.write = () => true;
  try { return fn(); } finally { process.stdout.write = o; process.stderr.write = e; }
}
const NO_CLOUD = { CLAUDE_CODE_USE_BEDROCK: null, CLAUDE_CODE_USE_VERTEX: null,
  ANTHROPIC_DEFAULT_SONNET_MODEL: null, ANTHROPIC_DEFAULT_HAIKU_MODEL: null, ANTHROPIC_DEFAULT_OPUS_MODEL: null };
function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === null) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const build = (...argv) => withEnv(NO_CLOUD, () => quiet(() => driverMain(argv)));
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const modelOf = (dir, agent) => /^model: (.+)$/m.exec(read(dir, 'agents', `${agent}.md`))?.[1] ?? null;

/** A Claude Code project install (`tiers`: 'auto' | 'off') and the console view of it. */
function claudeInstall(tiers, overrides = null) {
  const d = sandbox('gam-');
  const cfg = path.join(d, '.claude');
  if (overrides !== null) {
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(path.join(cfg, 'agent-overrides.json'), overrides);
  }
  assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral', '--tiers', tiers), 0);
  const st = webState('neutral', cfg);
  st.selectView(cfg, d, 'claude');
  return { d, cfg, st, file: path.join(cfg, 'agent-overrides.json') };
}
const rowOf = (res, name) => res.agents.find((a) => a.name === name);

// ---- 1. the precedence, row by row ----------------------------------------------------------------------

const ENV = { BEDROCK: { CLAUDE_CODE_USE_BEDROCK: '1' } };
// [tier, pin, tiers arg, expected model, expected from, warning expected]
const PRECEDENCE = [
  ['light', null, { map: {}, env: {} }, 'haiku', 'default', false],
  ['standard', null, { map: {}, env: {} }, 'sonnet', 'default', false],
  ['strong', null, { map: {}, env: {} }, null, 'inherit', false],
  ['light', null, { map: { light: 'claude-haiku-4-5' }, env: {} }, 'claude-haiku-4-5', 'map', false],
  ['light', null, { map: { light: '' }, env: {} }, null, 'inherit', false],
  ['light', 'opus', { map: { light: 'x' }, env: {} }, 'opus', 'pin', false],
  ['strong', 'sonnet', { map: {}, env: {} }, 'sonnet', 'pin', false],
  ['light', 'opus', null, 'opus', 'pin', false],
  ['light', null, null, null, 'inherit', false],
  ['light', null, { map: {}, env: ENV.BEDROCK }, 'haiku', 'default', true],
  ['light', 'opus', { map: {}, env: ENV.BEDROCK }, 'opus', 'pin', false],
];
for (const [tier, pin, tiers, model, from, warns] of PRECEDENCE) {
  test(`claudeAgentModel(${tier}, pin ${pin}, ${tiers ? JSON.stringify(tiers) : 'off'}) -> ${model ?? 'inherit'} (${from})`, () => {
    const r = claudeAgentModel(tier, pin, tiers);
    assert.equal(r.model, model);
    assert.equal(r.from, from);
    assert.equal(Boolean(r.warning), warns);
  });
}

// ---- 2. the edit, table by table ------------------------------------------------------------------------

const NAMES = ['explorer', 'developer', 'reviewer'];
const clone = (o) => JSON.parse(JSON.stringify(o));
const EDITS = [
  ['sets a tier, keeps the rest', { _version: '1', agents: { explorer: { model: 'opus', temperature: 0.2 } } },
    { tiers: { light: 'claude-haiku-4-5' } },
    { _version: '1', agents: { explorer: { model: 'opus', temperature: 0.2 } }, tiers: { light: 'claude-haiku-4-5' } }],
  ['an empty tier value is inherit, written as ""', {}, { tiers: { standard: '' } }, { tiers: { standard: '' } }],
  ['null removes a tier key (back to the default), the other stays',
    { tiers: { standard: 'a', light: 'b' } }, { tiers: { standard: null } }, { tiers: { light: 'b' } }],
  ['a value is trimmed', {}, { tiers: { light: '  haiku ' } }, { tiers: { light: 'haiku' } }],
  ['a pin creates the agent entry', { agents: {} }, { agents: { developer: 'opus' } }, { agents: { developer: { model: 'opus' } } }],
  ['a pin keeps the entry\'s other keys and the other agents',
    { agents: { developer: { temperature: 0.5 }, explorer: { model: 'x' } } }, { agents: { developer: 'opus' } },
    { agents: { developer: { temperature: 0.5, model: 'opus' }, explorer: { model: 'x' } } }],
  ['an empty pin removes model only', { agents: { developer: { model: 'opus', variant: 'high' } } },
    { agents: { developer: '' } }, { agents: { developer: { variant: 'high' } } }],
  ['a null pin removes model only', { agents: { developer: { model: 'opus', variant: 'high' } } },
    { agents: { developer: null } }, { agents: { developer: { variant: 'high' } } }],
  ['clearing a pin that is not there writes nothing new', { agents: {} }, { agents: { developer: null } }, { agents: {} }],
  ['a null agent entry is replaced when pinned', { agents: { developer: null } }, { agents: { developer: 'opus' } },
    { agents: { developer: { model: 'opus' } } }],
  ['tiers and pins in one save', {}, { tiers: { light: 'a' }, agents: { reviewer: 'opus' } },
    { tiers: { light: 'a' }, agents: { reviewer: { model: 'opus' } } }],
];
for (const [name, before, edit, after_] of EDITS) {
  test(`editOverrides: ${name}`, () => {
    const data = clone(before);
    assert.deepEqual(editOverrides(data, edit, NAMES), []);
    assert.deepEqual(data, after_);
  });
}

const REFUSED = [
  ['a line break in a value', {}, { tiers: { light: 'haiku\npermission: allow' } }, /tiers\.light contains a line break/],
  ['a non-string value', {}, { tiers: { light: 5 } }, /tiers\.light: a model name, or null/],
  ['strong takes no model', {}, { tiers: { strong: 'opus' } }, /tiers\.strong is not a tier that takes a model/],
  ['an agent the install lacks', {}, { agents: { ghost: 'opus' } }, /agents\.ghost is not an installed agent/],
  ['the prototype key', {}, { agents: { __proto__: 'opus' } }, /nothing to save/],
  ['a pin with a line break', {}, { agents: { developer: 'a\nb' } }, /agents\.developer\.model contains a line break/],
  ['tiers that is not an object', { tiers: [] }, { tiers: { light: 'a' } }, /"tiers" is not an object/],
  ['agents that is not an object', { agents: 3 }, { agents: { developer: 'a' } }, /"agents" is not an object/],
  ['an empty edit', {}, {}, /nothing to save/],
  ['a model past 200 characters', {}, { tiers: { light: 'x'.repeat(201) } }, /longer than 200/],
];
for (const [name, before, edit, re] of REFUSED) {
  test(`editOverrides refuses ${name}, and applies nothing`, () => {
    const data = clone(before);
    const problems = editOverrides(data, edit, NAMES);
    assert.match(problems.join('; '), re);
    assert.deepEqual(data, before);
  });
}

test('editOverrides applies nothing when one of two edits is refused', () => {
  const data = {};
  const problems = editOverrides(data, { tiers: { light: 'ok' }, agents: { ghost: 'x' } }, NAMES);
  assert.equal(problems.length, 1);
  assert.deepEqual(data, {});
});

// ---- 3. the read ----------------------------------------------------------------------------------------

test('the source tier of an agent comes from its marker, kit seats included', () => {
  const t = agentTiers();
  assert.equal(t.get('reviewer'), 'strong');
  assert.equal(t.get('explorer'), 'light');
  assert.equal(t.get('developer'), 'standard');
  assert.equal(t.get('react-reviewer'), 'strong', 'a kit agent is read from its own source');
});

test('GET on a --tiers auto install: each agent\'s tier, pin, model and why', () => {
  const { st } = claudeInstall('auto', JSON.stringify({ agents: { skeptic: { model: 'opus' } }, tiers: { standard: 'claude-x' } }));
  const res = withEnv(NO_CLOUD, () => apiAgentModels(st));
  assert.equal(res.claude, true);
  assert.equal(res.tiers, 'auto');
  assert.deepEqual(res.map, { standard: 'claude-x' });
  assert.deepEqual(res.defaults, { standard: 'sonnet', light: 'haiku' });
  assert.equal(res.file.problem, null);
  assert.deepEqual(rowOf(res, 'explorer'), { name: 'explorer', tier: 'light', pin: null, model: 'haiku', from: 'default' });
  assert.deepEqual(rowOf(res, 'developer'), { name: 'developer', tier: 'standard', pin: null, model: 'claude-x', from: 'map' });
  assert.deepEqual(rowOf(res, 'skeptic'), { name: 'skeptic', tier: 'light', pin: 'opus', model: 'opus', from: 'pin' });
  assert.deepEqual(rowOf(res, 'reviewer'), { name: 'reviewer', tier: 'strong', pin: null, model: null, from: 'inherit' });
  assert.deepEqual(res.warnings, []);
});

test('GET with the routing off: only a pin gives a model', () => {
  const { st } = claudeInstall('off', JSON.stringify({ agents: { skeptic: { model: 'opus' } } }));
  const res = apiAgentModels(st);
  assert.equal(res.tiers, 'off');
  assert.equal(rowOf(res, 'explorer').model, null);
  assert.equal(rowOf(res, 'explorer').from, 'inherit');
  assert.equal(rowOf(res, 'explorer').tier, 'light', 'the badge shows with the routing off');
  assert.equal(rowOf(res, 'skeptic').model, 'opus');
});

test('GET names the Bedrock alias problem of the console\'s own environment, once, only for unpinned tiers', () => {
  const { st } = claudeInstall('auto', JSON.stringify({ agents: Object.fromEntries(
    [...agentTiers()].filter(([, t]) => t === 'standard').map(([n]) => [n, { model: 'opus' }])) }));
  const res = apiAgentModels(st, { CLAUDE_CODE_USE_BEDROCK: '1' });
  assert.equal(res.warnings.length, 1, 'every standard agent is pinned: only the light tier warns');
  assert.match(res.warnings[0], /ANTHROPIC_DEFAULT_HAIKU_MODEL/);
});

test('GET names the alias problem even while the routing is still off (the editor shows on a picked auto)', () => {
  const { st } = claudeInstall('off');
  const res = apiAgentModels(st, { CLAUDE_CODE_USE_BEDROCK: '1' });
  assert.equal(res.tiers, 'off');
  assert.equal(res.warnings.length, 2, 'one for the standard alias, one for the light');
  assert.equal(rowOf(res, 'explorer').model, null, 'the model itself is still off');
});

test('GET prints nothing on stderr for a bad entry in the user\'s file', () => {
  const { st } = claudeInstall('auto', JSON.stringify({ agents: { developer: { model: 'a\nb' } }, tiers: { strong: 'x' } }));
  const o = process.stderr.write;
  let err = '';
  process.stderr.write = (s) => { err += String(s); return true; };
  let res;
  try { res = apiAgentModels(st); } finally { process.stderr.write = o; }
  assert.equal(err, '');
  assert.equal(rowOf(res, 'developer').pin, null, 'the bad pin is dropped, as the build drops it');
});

test('GET on an unparseable file reports the problem and sets nothing', () => {
  const { st } = claudeInstall('auto', '{ "tiers": ');
  const res = apiAgentModels(st);
  assert.match(res.file.problem, /not valid JSON/);
  assert.deepEqual(res.map, {});
});

test('GET on another host: a tier per agent, no model', () => {
  const d = sandbox('gam-oc-');
  assert.equal(build('--emit', 'opencode', '--out', d, '--theme', 'neutral'), 0);
  const cfg = path.join(d, '.opencode');
  const st = webState('neutral', cfg);
  st.selectView(cfg, d, 'opencode');
  const res = apiAgentModels(st);
  assert.equal(res.claude, false);
  assert.equal(rowOf(res, 'explorer').tier, 'light');
  assert.equal('model' in rowOf(res, 'explorer'), false);
  assert.equal(apiAgentModelsSave(st, { tiers: { light: 'x' } }).ok, false);
  assert.equal(fs.existsSync(path.join(cfg, 'agent-overrides.json')) && read(cfg, 'agent-overrides.json').includes('"x"'), false);
});

// ---- 4. the write ---------------------------------------------------------------------------------------

test('POST merges key by key, keeps every other key, and the next build reads it', () => {
  const { st, cfg, d, file } = claudeInstall('auto', '{"_version": "9", "note": [1, 2], "agents": {"explorer": {"temperature": 1.0}}, "tiers": {"standard": "keep-me"}}');
  const res = apiAgentModelsSave(st, { tiers: { light: 'claude-haiku-4-5' }, agents: { reviewer: 'opus' } });
  assert.equal(res.ok, true);
  assert.equal(res.rebuild, true);
  const saved = JSON.parse(read(cfg, 'agent-overrides.json'));
  assert.deepEqual(saved, { _version: '9', note: [1, 2],
    agents: { explorer: { temperature: 1.0 }, reviewer: { model: 'opus' } },
    tiers: { standard: 'keep-me', light: 'claude-haiku-4-5' } });
  assert.match(read(cfg, 'agent-overrides.json'), /"temperature": 1\.0/, 'a float keeps its spelling');
  assert.deepEqual(loadTierMap(cfg, () => { assert.fail('a saved map reads back clean'); }), { standard: 'keep-me', light: 'claude-haiku-4-5' });
  // The reply is the fresh read.
  assert.equal(rowOf(res, 'explorer').model, 'claude-haiku-4-5');
  // THE PAGE AND THE BUILD AGREE: after the rebuild each agent's `model:` line is what the API said.
  assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral', '--tiers', 'auto'), 0);
  for (const name of ['explorer', 'developer', 'reviewer', 'skeptic', 'security']) {
    assert.equal(modelOf(cfg, name), rowOf(apiAgentModels(st), name).model, `${name}: the API and the emitted file say the same`);
  }
  assert.equal(modelOf(cfg, 'reviewer'), 'opus');
  assert.ok(file);
});

test('POST creates the file when there is none, and clears a pin without touching the entry', () => {
  const { st, cfg, file } = claudeInstall('auto');
  fs.rmSync(file, { force: true });
  assert.equal(apiAgentModelsSave(st, { agents: { developer: 'opus' } }).ok, true);
  assert.deepEqual(JSON.parse(read(cfg, 'agent-overrides.json')), { agents: { developer: { model: 'opus' } } });
  fs.writeFileSync(file, JSON.stringify({ agents: { developer: { model: 'opus', variant: 'high' } } }));
  assert.equal(apiAgentModelsSave(st, { agents: { developer: '' } }).ok, true);
  assert.deepEqual(JSON.parse(read(cfg, 'agent-overrides.json')), { agents: { developer: { variant: 'high' } } });
});

test('the first save against what a plain emit leaves behind works, and keeps its keys', () => {
  // NO pre-written overrides: the file (or its absence) a real user has on the first save.
  const { st, cfg, file } = claudeInstall('auto');
  const stub = fs.existsSync(file) ? JSON.parse(read(cfg, 'agent-overrides.json')) : {};
  const res = apiAgentModelsSave(st, { tiers: { light: 'claude-haiku-4-5' }, agents: { reviewer: 'opus' } });
  assert.equal(res.ok, true, res.error);
  const saved = JSON.parse(read(cfg, 'agent-overrides.json'));
  for (const [k, v] of Object.entries(stub)) {
    if (k !== 'tiers' && k !== 'agents') assert.deepEqual(saved[k], v, `the stub's ${k} is kept`);
  }
  assert.equal(saved.tiers.light, 'claude-haiku-4-5');
  assert.equal(saved.agents.reviewer.model, 'opus');
});

test('POST refuses a file that does not parse, and leaves its bytes alone', () => {
  const broken = '{\n  // my notes\n  "tiers": {}\n}\n';
  const { st, file } = claudeInstall('auto', broken);
  const res = apiAgentModelsSave(st, { tiers: { light: 'x' } });
  assert.equal(res.ok, false);
  assert.match(res.error, /not valid JSON/);
  assert.equal(fs.readFileSync(file, 'utf8'), broken);
});

test('POST refuses an invalid value with the reason, and writes nothing', () => {
  const { st, file } = claudeInstall('auto', '{"agents": {}}');
  const before = fs.readFileSync(file, 'utf8');
  const res = apiAgentModelsSave(st, { tiers: { light: 'a\nb' }, agents: { developer: 'opus' } });
  assert.equal(res.ok, false);
  assert.match(res.error, /tiers\.light contains a line break/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});
