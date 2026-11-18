// The models one install can run a sub-agent on (js/web/model-catalog.mjs), per host.
//
// Written out, not recorded. The rules this file holds:
//   1. A COMPANY SETUP WORKS ALONE. An OpenCode custom provider (private URL, key given as `{env:X}`,
//      in-house model names) lists its own `models` map with what the config says (name, limit, cost,
//      variants) when there is no models.dev cache, no auth.json and no local runtime. A missing
//      catalogue is not an error and adds no note. The catalogue only fills what the config lacks.
//   2. The catalogue lists a provider only when it is connected: an auth.json entry or one of its env
//      vars set. `enabled_providers`/`disabled_providers` apply; alpha and deprecated models are dropped.
//      Both config keys count: `provider` (V1) and `providers` (V2); JSONC comments are fine.
//   3. Local runtimes are probed on loopback only, with no header; Ollama `/api/tags`, LM Studio
//      `/api/v1/models` then `/api/v0/models`. One that does not answer stays a group, "not running".
//   4. OpenClaude lists the active provider's model (env, `.openclaude-profile.json`, the active entry
//      of `.openclaude.json`), the keys of `agentModels` as routes, and sonnet/haiku/opus only while the
//      provider is Anthropic. Its active base URL, equal after normalising to an OpenCode custom
//      provider's, brings that provider's models, labelled with the provider.
//   5. Claude Code lists opus/sonnet/haiku/fable, filtered by `availableModels`.
//   6. Every id written in agent-overrides.json is in an "In use" group, marked `detected` only when a
//      source lists it.
//   7. NO SECRET EVER LEAVES: no key value in a response, no header on a probe, no request that is not
//      loopback. If a rule below is wrong, change the row AND the sentence above it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';

import { main as driverMain } from '../../js/build/driver.mjs';
import { normalizeUrl, readModelCatalog } from '../../js/web/model-catalog.mjs';
import { apiAgentModelsFull } from '../../js/web/agent-models-api.mjs';
import { webState } from '../helpers/web_api_fixture.mjs';
import { makeSandbox, restoreProcessHome, sandboxProcessHome } from '../helpers/sandbox.mjs';

sandboxProcessHome();
const sandboxes = [];
after(() => { for (const sb of sandboxes) sb.cleanup(); restoreProcessHome(); });
const sandbox = (prefix) => { const sb = makeSandbox(prefix); sandboxes.push(sb); return sb.path; };

const SENTINEL = 'sk-SENTINEL-do-not-leak-0123456789';
const put = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
};

/** A fetch that records every call and answers from `routes` (url -> body), else refuses like a closed port. */
function fakeFetch(routes = {}) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    if (!Object.hasOwn(routes, url)) throw new Error('ECONNREFUSED');
    return { ok: true, json: async () => routes[url] };
  };
  fn.calls = calls;
  return fn;
}
const OLLAMA_URL = 'http://127.0.0.1:11434/api/tags';
const LMS1 = 'http://127.0.0.1:1234/api/v1/models';
const LMS0 = 'http://127.0.0.1:1234/api/v0/models';

/** A fresh machine: `home` and an env that names no host variable of the real one. */
function machine(env = {}) { return { home: sandbox('mc-home-'), env: { ...env } }; }
const opencodeFile = (m, name = 'opencode.jsonc') => path.join(m.home, '.config', 'opencode', name);
const ids = (res) => res.models.map((r) => r.id);
const byId = (res, id, provider) => res.models.find((r) => r.id === id && (!provider || r.provider === provider));
const read = (ctx) => readModelCatalog({ scope: 'global', fetchFn: fakeFetch(), ...ctx });

// The company setup of the spec's fixture.
const OFFICE_JSONC = `{
  // our gateway; the key comes from the environment
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "corp": {
      "name": "Corp LLM",
      "npm": "@ai-sdk/openai-compatible",
      /* the key is never read by Geneseed */
      "options": { "baseURL": "https://llm.internal.example/v1", "apiKey": "{env:CORP_LLM_KEY}", "headers": { "Authorization": "Bearer ${SENTINEL}" } },
      "models": {
        "corp-coder-xl": { "name": "Coder XL", "limit": { "context": 128000, "output": 8192 }, "variants": { "high": {}, "low": {} } },
        "corp-fast": { "cost": { "input": 0.1, "output": 0.4 } }
      }
    }
  }
}
`;

test('an OpenCode company setup alone: both models, the config\'s own metadata, no catalogue, no note, no key', async () => {
  const m = machine({ CORP_LLM_KEY: SENTINEL });
  put(opencodeFile(m), OFFICE_JSONC);
  const f = fakeFetch();
  const res = await readModelCatalog({ host: 'opencode', scope: 'global', dir: path.dirname(opencodeFile(m)), root: path.dirname(opencodeFile(m)), ...m, fetchFn: f });
  assert.deepEqual(ids(res), ['inherit', 'corp/corp-coder-xl', 'corp/corp-fast']);
  assert.deepEqual(byId(res, 'corp/corp-coder-xl'), {
    id: 'corp/corp-coder-xl', name: 'Coder XL', provider: 'corp', providerName: 'Corp LLM', source: 'config',
    note: 'configured in opencode.jsonc', local: false, available: true, context: 128000, output: 8192, variants: ['high', 'low'],
  });
  assert.deepEqual(byId(res, 'corp/corp-fast').cost, { input: 0.1, output: 0.4 });
  assert.equal(byId(res, 'corp/corp-fast').name, 'corp-fast', 'no name in the config: the id');
  // The two local runtimes did not answer: groups, and nothing else.
  assert.deepEqual(res.groups.filter((g) => g.source === 'local').map((g) => [g.provider, g.note, g.available]),
    [['ollama', 'local · not running', false], ['lmstudio', 'local · not running', false]]);
  assert.equal(JSON.stringify(res).includes(SENTINEL), false, 'the key (env or inline header) never appears');
  assert.equal(JSON.stringify(res).includes('CORP_LLM_KEY'), false, 'not even the variable name');
});

test('the catalogue lists connected providers only, drops alpha and deprecated, honours the lists', async () => {
  const m = machine({ ANTHROPIC_API_KEY: SENTINEL });
  put(path.join(m.home, '.cache', 'opencode', 'models.json'), {
    anthropic: { id: 'anthropic', name: 'Anthropic', env: ['ANTHROPIC_API_KEY'], models: {
      'claude-x': { name: 'Claude X', limit: { context: 200000, output: 64000 }, cost: { input: 3, output: 15 }, reasoning: true },
      'claude-old': { name: 'Old', status: 'deprecated' }, 'claude-new': { name: 'New', status: 'alpha' } } },
    openai: { id: 'openai', name: 'OpenAI', env: ['OPENAI_API_KEY'], models: { 'gpt-z': { name: 'GPT Z' } } },
    groq: { id: 'groq', name: 'Groq', env: ['GROQ_API_KEY'], models: { 'llama-q': { name: 'Llama Q' } } },
    mistral: { id: 'mistral', name: 'Mistral', env: ['MISTRAL_API_KEY'], models: { 'mis-1': { name: 'Mis 1' } } },
  });
  put(path.join(m.home, '.local', 'share', 'opencode', 'auth.json'), { openai: { type: 'api', key: SENTINEL }, mistral: { type: 'oauth' } });
  put(opencodeFile(m, 'opencode.json'), { disabled_providers: ['mistral'] });
  const res = await read({ host: 'opencode', dir: m.home, root: m.home, ...m });
  assert.deepEqual(ids(res), ['inherit', 'anthropic/claude-x', 'openai/gpt-z']);
  assert.deepEqual(byId(res, 'anthropic/claude-x'), { id: 'anthropic/claude-x', name: 'Claude X', provider: 'anthropic', providerName: 'Anthropic',
    source: 'catalogue', note: 'catalogue · key found', local: false, available: true, context: 200000, output: 64000, cost: { input: 3, output: 15 }, reasoning: true });
  assert.equal(byId(res, 'openai/gpt-z').note, 'catalogue · credentials saved');
  assert.equal(JSON.stringify(res).includes(SENTINEL), false);
  // `enabled_providers` narrows it to the list.
  put(opencodeFile(m, 'opencode.json'), { enabled_providers: ['openai'] });
  assert.deepEqual(ids(await read({ host: 'opencode', dir: m.home, root: m.home, ...m })), ['inherit', 'openai/gpt-z']);
  // OPENCODE_MODELS_PATH relocates the catalogue.
  const elsewhere = path.join(sandbox('mc-cat-'), 'm.json');
  put(elsewhere, { zed: { name: 'Zed', env: ['ZED_KEY'], models: { 'z-1': {} } } });
  const m2 = machine({ OPENCODE_MODELS_PATH: elsewhere, ZED_KEY: '1' });
  assert.deepEqual(ids(await read({ host: 'opencode', dir: m2.home, root: m2.home, ...m2 })), ['inherit', 'zed/z-1']);
});

test('the V2 key `providers` counts, a project config adds its own, and the catalogue only enriches a matching id', async () => {
  const m = machine();
  put(opencodeFile(m, 'opencode.json'), { providers: { corp: { name: 'Corp', options: { baseURL: 'https://x/v1' }, models: { 'big': { name: 'Big' }, 'plain': {} } } } });
  const project = sandbox('mc-proj-');
  put(path.join(project, 'opencode.jsonc'), '{ // project\n "provider": { "lab": { "models": { "m1": { "limit": { "context": 1000 } } } } } }');
  put(path.join(m.home, '.cache', 'opencode', 'models.json'), {
    corp: { name: 'Corp', env: [], models: { big: { limit: { context: 777, output: 9 }, cost: { input: 1, output: 2 }, reasoning: false } } },
  });
  const res = await read({ host: 'opencode', scope: 'project', dir: project, root: project, ...m });
  assert.deepEqual(ids(res), ['inherit', 'corp/big', 'corp/plain', 'lab/m1']);
  assert.deepEqual([res.models[1].context, res.models[1].output, res.models[1].cost, res.models[1].reasoning], [777, 9, { input: 1, output: 2 }, false]);
  assert.equal('context' in byId(res, 'corp/plain'), false, 'an id the catalogue does not know gets nothing');
  assert.equal(byId(res, 'lab/m1').note, 'configured in opencode.jsonc');
  assert.equal(byId(res, 'lab/m1').providerName, 'lab', 'no name: the provider id');
  // A config that does not parse is skipped, not fatal.
  put(opencodeFile(m, 'opencode.json'), '{ not json');
  assert.deepEqual(ids(await read({ host: 'opencode', scope: 'project', dir: project, root: project, ...m })), ['inherit', 'lab/m1']);
});

test('local runtimes: Ollama and LM Studio list their models, with no header and loopback only', async () => {
  const m = machine();
  const f = fakeFetch({
    [OLLAMA_URL]: { models: [{ name: 'llama3:8b' }, { model: 'qwen:7b' }] },
    [LMS0]: { data: [{ id: 'phi-4' }, { id: 'nomic-embed', type: 'embeddings' }] },
  });
  const res = await readModelCatalog({ host: 'opencode', scope: 'global', dir: m.home, root: m.home, ...m, fetchFn: f });
  assert.deepEqual(ids(res), ['inherit', 'ollama/llama3:8b', 'ollama/qwen:7b', 'lmstudio/phi-4']);
  assert.deepEqual(byId(res, 'lmstudio/phi-4'), { id: 'lmstudio/phi-4', name: 'phi-4', provider: 'lmstudio', providerName: 'LM Studio', source: 'local', note: 'local · running', local: true, available: true });
  assert.deepEqual(res.groups.filter((g) => g.source === 'local').map((g) => [g.provider, g.note]), [['ollama', 'local · running'], ['lmstudio', 'local · running']]);
  for (const c of f.calls) {
    assert.match(c.url, /^http:\/\/127\.0\.0\.1:(11434|1234)\//, 'loopback only');
    assert.equal(c.init.headers, undefined, 'no Authorization, no header at all');
  }
  assert.deepEqual(f.calls.map((c) => c.url).sort(), [LMS0, LMS1, OLLAMA_URL].sort(), 'LM Studio falls back v1 -> v0');
  // LM Studio's newer shape.
  const f2 = fakeFetch({ [LMS1]: { models: [{ key: 'qwen-vl', display_name: 'Qwen VL' }] } });
  assert.deepEqual(ids(await readModelCatalog({ host: 'opencode', scope: 'global', dir: m.home, root: m.home, ...m, fetchFn: f2 })), ['inherit', 'lmstudio/qwen-vl']);
});

test('the office OpenClaude: the env provider, and the OpenCode provider on the same endpoint brings the in-house names', async () => {
  const m = machine({ CLAUDE_CODE_USE_OPENAI: '1', OPENAI_BASE_URL: 'https://llm.internal.example/v1/', OPENAI_MODEL: 'corp-coder-xl', OPENAI_API_KEY: SENTINEL });
  put(opencodeFile(m), OFFICE_JSONC);
  const res = await read({ host: 'openclaude', dir: path.join(m.home, '.openclaude'), root: m.home, ...m });
  assert.deepEqual(ids(res), ['inherit', 'corp-coder-xl', 'corp-fast'], 'both corp models; the active one is not listed twice; no Anthropic alias on a non-Anthropic provider');
  assert.equal(byId(res, 'corp-coder-xl').note, 'same endpoint as OpenCode provider corp');
  assert.equal(byId(res, 'corp-coder-xl').context, 128000);
  assert.equal(JSON.stringify(res).includes(SENTINEL), false);
});

// [OpenClaude base URL, OpenCode baseURL, same endpoint?]
const URL_ROWS = [
  ['https://llm.internal.example/v1/', 'https://llm.internal.example/v1', true],
  ['https://LLM.Internal.Example', 'https://llm.internal.example/v1', true],
  ['https://llm.internal.example/v1', 'https://llm.internal.example/', true],
  ['https://llm.internal.example/v1', 'https://other.internal.example/v1', false],
  ['https://llm.internal.example:8443/v1', 'https://llm.internal.example/v1', false],
  ['https://llm.internal.example/api', 'https://llm.internal.example/v1', false],
  ['http://llm.internal.example/v1', 'https://llm.internal.example/v1', false],
];
for (const [oc, op, same] of URL_ROWS) {
  test(`OpenClaude ${oc} vs OpenCode ${op}: ${same ? 'the same endpoint' : 'not the same'}`, async () => {
    const m = machine({ CLAUDE_CODE_USE_OPENAI: '1', OPENAI_BASE_URL: oc, OPENAI_MODEL: 'active-one' });
    put(opencodeFile(m), { provider: { corp: { options: { baseURL: op }, models: { 'in-house': {} } } } });
    const res = await read({ host: 'openclaude', dir: path.join(m.home, '.openclaude'), root: m.home, ...m });
    assert.deepEqual(ids(res), same ? ['inherit', 'in-house', 'active-one'] : ['inherit', 'active-one']);
  });
}

test('normalizeUrl: host case, trailing slashes and /v1 are not differences; a path or a port is', () => {
  for (const [a, b] of [['https://A.b/v1/', 'https://a.b'], ['HTTPS://A.B/', 'https://a.b/v1'], ['https://a.b/v1//', 'https://a.b']]) {
    assert.equal(normalizeUrl(a), normalizeUrl(b), `${a} ~ ${b}`);
  }
  assert.notEqual(normalizeUrl('https://a.b/v2'), normalizeUrl('https://a.b'));
  assert.equal(normalizeUrl(undefined), '');
  assert.equal(normalizeUrl('  '), '');
});

test('OpenClaude: the profile file, .openclaude.json, routes, local runtimes and the aliases only on Anthropic', async () => {
  // 1. the active entry of ~/.openclaude.json, a Gemini profile file, and agentModels routes
  const m = machine();
  put(path.join(m.home, '.openclaude.json'), { activeProviderProfileId: 'p2', providerProfiles: [
    { id: 'p1', provider: 'openai', model: 'other' }, { id: 'p2', provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'llama3:8b', apiKey: SENTINEL }] });
  put(path.join(m.home, '.openclaude', 'settings.json'), { agentModels: { 'fast-route': { model: 'x', api_key: SENTINEL }, deep: {} } });
  const f = fakeFetch({ [OLLAMA_URL]: { models: [{ name: 'llama3:8b' }, { name: 'mistral:7b' }] } });
  const res = await readModelCatalog({ host: 'openclaude', scope: 'global', dir: path.join(m.home, '.openclaude'), root: m.home, ...m, fetchFn: f });
  assert.deepEqual(ids(res), ['inherit', 'llama3:8b', 'mistral:7b', 'fast-route', 'deep']);
  assert.equal(byId(res, 'llama3:8b').local, true);
  assert.equal(byId(res, 'fast-route').note, 'route');
  assert.equal(JSON.stringify(res).includes(SENTINEL), false);
  // 2. `.openclaude-profile.json` env (Gemini); a remote one gets no probe, and no key means unavailable
  const g = machine();
  put(path.join(g.home, '.openclaude', '.openclaude-profile.json'), { profile: 'gemini', env: { CLAUDE_CODE_USE_GEMINI: '1', GEMINI_MODEL: 'gemini-2.5-pro', GEMINI_API_KEY: SENTINEL } });
  const f2 = fakeFetch();
  const gres = await readModelCatalog({ host: 'openclaude', scope: 'global', dir: path.join(g.home, '.openclaude'), root: g.home, ...g, fetchFn: f2 });
  assert.deepEqual(ids(gres), ['inherit', 'gemini-2.5-pro']);
  assert.equal(byId(gres, 'gemini-2.5-pro').available, true);
  assert.equal(f2.calls.length, 0, 'a remote provider is never probed');
  assert.equal(JSON.stringify(gres).includes(SENTINEL), false);
  const nokey = machine({ CLAUDE_CODE_USE_OPENAI: '1', OPENAI_BASE_URL: 'https://api.example/v1', OPENAI_MODEL: 'm1' });
  const nres = await read({ host: 'openclaude', dir: nokey.home, root: nokey.home, ...nokey });
  assert.deepEqual([byId(nres, 'm1').available, byId(nres, 'm1').reason], [false, 'no key found']);
  // 3. Anthropic itself (no provider switch): the three aliases
  const a = machine();
  assert.deepEqual(ids(await read({ host: 'openclaude', dir: a.home, root: a.home, ...a })), ['inherit', 'opus', 'sonnet', 'haiku']);
});

test('Claude Code: the four aliases, filtered by availableModels (family, version prefix or full id)', async () => {
  const dir = sandbox('mc-claude-');
  const ctx = (env = {}) => read({ host: 'claude', dir, root: dir, home: dir, env });
  assert.deepEqual(ids(await ctx()), ['inherit', 'opus', 'sonnet', 'haiku', 'fable']);
  put(path.join(dir, 'settings.json'), { availableModels: ['sonnet', 'claude-haiku-4-5', 'my-custom-model'] });
  const res = await ctx();
  assert.deepEqual(ids(res), ['inherit', 'sonnet', 'haiku', 'my-custom-model']);
  assert.equal(byId(res, 'my-custom-model').note, 'availableModels');
});

test('an id written in agent-overrides.json is "In use", marked detected only when a source lists it', async () => {
  const m = machine();
  put(opencodeFile(m), OFFICE_JSONC);
  const res = await read({ host: 'opencode', dir: m.home, root: m.home, ...m, inUse: ['corp/corp-fast', 'corp/typed-by-hand', 'corp/typed-by-hand', ''] });
  const inUse = res.models.filter((r) => r.provider === 'in-use');
  assert.deepEqual(inUse.map((r) => [r.id, r.detected]), [['corp/corp-fast', true], ['corp/typed-by-hand', false]]);
  assert.deepEqual(res.groups.at(-1), { provider: 'in-use', providerName: 'In use', source: 'in-use', note: 'written in agent-overrides.json', local: false, available: true });
  assert.equal(res.models.filter((r) => r.id === 'corp/corp-fast').length, 2, 'listed under its provider too');
});

// ---- the API and the build, end to end -------------------------------------------------------------

const quiet = (fn) => {
  const o = process.stdout.write; const e = process.stderr.write;
  process.stdout.write = () => true; process.stderr.write = () => true;
  try { return fn(); } finally { process.stdout.write = o; process.stderr.write = e; }
};
const modelOf = (dir, agent) => /^model: (.+?)\r?$/m.exec(fs.readFileSync(path.join(dir, 'agents', `${agent}.md`), 'utf8'))?.[1] ?? null;

test('office setup end to end: both hosts list both models, tiers on corp-fast write the model, no key anywhere', async () => {
  const m = machine({ CORP_LLM_KEY: SENTINEL, CLAUDE_CODE_USE_OPENAI: '1', OPENAI_BASE_URL: 'https://llm.internal.example/v1/', OPENAI_MODEL: 'corp-coder-xl' });
  put(opencodeFile(m), OFFICE_JSONC);
  const f = fakeFetch();
  const built = (emit, d, overrides) => {
    put(overrides.file, overrides.data);
    assert.equal(quiet(() => driverMain(['--emit', emit, '--out', d, '--theme', 'neutral', '--tiers', 'auto'])), 0);
  };
  // OpenCode project install; the global config above is read too.
  const oc = sandbox('mc-oc-');
  built('opencode', oc, { file: path.join(oc, 'agent-overrides.json'), data: { tiers: { light: 'corp/corp-fast' } } });
  const ocState = webState('neutral', oc); ocState.selectView(oc, oc, 'opencode');
  const ocRes = await apiAgentModelsFull(ocState, { env: m.env, home: m.home, fetchFn: f });
  assert.deepEqual(ocRes.models.filter((r) => r.source === 'config').map((r) => r.id), ['corp/corp-coder-xl', 'corp/corp-fast']);
  assert.equal(ocRes.models.find((r) => r.id === 'corp/corp-fast' && r.provider === 'in-use').detected, true);
  assert.equal(ocRes.agents.find((a) => a.name === 'explorer').model, 'corp/corp-fast');
  assert.equal(modelOf(path.join(oc, '.opencode'), 'explorer'), 'corp/corp-fast');
  assert.equal(modelOf(path.join(oc, '.opencode'), 'developer'), null);
  // OpenClaude project install.
  const cl = sandbox('mc-cl-');
  built('openclaude', cl, { file: path.join(cl, '.openclaude', 'agent-overrides.json'), data: { tiers: { light: 'corp-fast' } } });
  const clState = webState('neutral', path.join(cl, '.openclaude')); clState.selectView(path.join(cl, '.openclaude'), cl, 'openclaude');
  const clRes = await apiAgentModelsFull(clState, { env: m.env, home: m.home, fetchFn: f });
  assert.deepEqual(clRes.models.filter((r) => r.source === 'config').map((r) => r.id), ['corp-coder-xl', 'corp-fast']);
  assert.equal(modelOf(path.join(cl, '.openclaude'), 'explorer'), 'corp-fast');
  assert.deepEqual(clRes.defaults, {});
  for (const res of [ocRes, clRes]) {
    assert.equal(JSON.stringify(res).includes(SENTINEL), false, 'the sentinel key appears in no response');
    assert.equal(res.tiers, 'auto');
  }
  for (const c of f.calls) assert.match(c.url, /^http:\/\/127\.0\.0\.1:/, 'nothing but loopback was called');
});

test('Bob answers no models', async () => {
  const d = sandbox('mc-bob-');
  assert.equal(quiet(() => driverMain(['--emit', 'bob', '--out', d, '--theme', 'neutral'])), 0);
  const st = webState('neutral', path.join(d, '.bob')); st.selectView(path.join(d, '.bob'), d, 'bob');
  const res = await apiAgentModelsFull(st, { env: {}, home: d, fetchFn: fakeFetch() });
  assert.deepEqual([res.claude, res.models, res.groups], [false, [], []]);
});
