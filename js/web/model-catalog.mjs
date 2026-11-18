/**
 * The models one install can run a sub-agent on — what `GET /api/agent-models` lists as `models`.
 *
 * ONE READER PER HOST, files and local probes only, and NEVER A SECRET (spec D3): an API key is
 * never returned, logged or sent. Only its presence is a boolean, and only where a catalogue
 * provider's `env` names it or `auth.json` holds an entry for it; a custom provider's `options`
 * (`apiKey`, headers, `{env:X}`) is never looked at, and no remote or private `/v1/models` is ever
 * called. The one network use is `GET` on `127.0.0.1` (Ollama 11434, LM Studio 1234), no header,
 * one second. Whitelist the fields you copy; a row is built from named fields, never spread.
 *
 * A COMPANY SETUP COMES FIRST. A private URL, a private key and in-house model names are known to
 * no catalogue, so a custom provider's own `models` map is the primary source (with the `name`,
 * `limit`, `cost`, `variants` the config itself gives) and `models.dev` is enrichment only, for an
 * id that matches. A missing catalogue, `auth.json` or runtime is not an error and says nothing.
 * OpenClaude, whose profile names a base URL, reuses the OpenCode custom provider on the same
 * endpoint, so the in-house names reach it without calling the endpoint.
 *
 * A row: `{ id, name, provider, providerName, source, note, local, available, reason?, context?,
 * output?, cost?, reasoning?, variants? }`; `id` is the value written into `model:`. A group
 * (`groups`) is one provider with its source line and availability, so a local runtime that is not
 * running still shows. `inherit` is the first row on every host.
 */
import os from 'node:os';
import path from 'node:path';

import { isFile, readText } from '../lib/fs.mjs';
import { isDict, isTruthy } from '../lib/json.mjs';
import { loadJsonObject } from '../hosts/settings.mjs';
import { loadAgentOverrides } from '../hosts/native.mjs';

/** How many agents of the install at `dir` carry a model pin: the Installs panel's one-line summary. */
export function pinCountOf(dir) {
  return Object.values(loadAgentOverrides(dir, () => {})).filter((e) => isDict(e) && isTruthy(e.model)).length;
}

const PROBE_MS = 1000;
/** The aliases a Claude Code sub-agent accepts; `default`/`best`/`opusplan` are not agent values. */
const CLAUDE_ALIASES = [['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku'], ['fable', 'Fable']];

const SESSION = { provider: 'session', providerName: 'Session model', source: 'session' };

/** Lower-cased host, no trailing `/`, no `/v1`: two spellings of one endpoint compare equal. */
export function normalizeUrl(u) {
  if (typeof u !== 'string' || !u.trim()) return '';
  let s = u.trim();
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)(.*)$/i.exec(s);
  if (m) s = `${m[1].toLowerCase()}${m[2].toLowerCase()}${m[3]}`;
  s = s.replace(/\/+$/, '').replace(/\/v1$/i, '').replace(/\/+$/, '');
  return s;
}

const isLocalUrl = (u) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])([:/]|$)/i.test(String(u ?? '').trim());
// The JSONC reader hands a number back as `parseJson`'s wrapper object, so `+v` reads both forms.
const num = (v) => {
  if (typeof v === 'boolean' || v === null || v === undefined || Array.isArray(v) || isDict(v)) return undefined;
  return typeof v === 'number' || typeof v === 'object' ? (Number.isFinite(+v) ? +v : undefined) : undefined;
};
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** A row from named fields only. `extra` is `{ name, limit, cost, reasoning, variants }` from a config or catalogue. */
function row(id, base, extra = {}) {
  const r = { id, name: text(extra.name) ?? id, ...base, available: base.available ?? true };
  if (r.available) delete r.reason;
  const context = num(extra.limit?.context); if (context !== undefined) r.context = context;
  const output = num(extra.limit?.output); if (output !== undefined) r.output = output;
  const ci = num(extra.cost?.input); const co = num(extra.cost?.output);
  if (ci !== undefined || co !== undefined) r.cost = { input: ci ?? null, output: co ?? null };
  if (typeof extra.reasoning === 'boolean') r.reasoning = extra.reasoning;
  const v = isDict(extra.variants) ? Object.keys(extra.variants) : Array.isArray(extra.variants) ? extra.variants.filter((x) => typeof x === 'string') : null;
  if (v && v.length) r.variants = v;
  return r;
}

/** Fill what a row lacks from a catalogue model of the same id; never overwrite what the config said. */
function enrich(r, cat) {
  if (!isDict(cat)) return r;
  const from = row(r.id, {}, cat);
  for (const k of ['context', 'output', 'cost', 'reasoning', 'variants']) if (r[k] === undefined && from[k] !== undefined) r[k] = from[k];
  return r;
}

function readJson(p) {
  try { const d = JSON.parse(readText(p)); return isDict(d) ? d : null; } catch { return null; }
}

/** `GET url` on loopback, no header at all, `PROBE_MS`; the parsed body or null. */
async function probe(fetchFn, url) {
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(PROBE_MS) });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** `{ name, ids }` of the local runtime, `ids` null when it does not answer. */
async function localRuntime(fetchFn, which) {
  if (which === 'ollama') {
    const d = await probe(fetchFn, 'http://127.0.0.1:11434/api/tags');
    const ids = Array.isArray(d?.models) ? d.models.map((m) => text(m?.name) ?? text(m?.model)).filter(Boolean) : null;
    return { id: 'ollama', name: 'Ollama', ids };
  }
  let d = await probe(fetchFn, 'http://127.0.0.1:1234/api/v1/models');
  if (!d) d = await probe(fetchFn, 'http://127.0.0.1:1234/api/v0/models');
  const list = Array.isArray(d?.models) ? d.models : Array.isArray(d?.data) ? d.data : null;
  const ids = list ? list.filter((m) => !/embed/i.test(String(m?.type ?? ''))).map((m) => text(m?.key) ?? text(m?.id)).filter(Boolean) : null;
  return { id: 'lmstudio', name: 'LM Studio', ids };
}

/** Both local runtimes, probed together. */
const localRuntimes = (fetchFn) => Promise.all([localRuntime(fetchFn, 'ollama'), localRuntime(fetchFn, 'lmstudio')]);

// ---- OpenCode ------------------------------------------------------------------------------------

const xdg = (env, home, name, dflt) => env[name] || path.join(home, dflt);

/** The opencode config files that apply: the user's, then the project's. Order is merge order. */
function opencodeConfigFiles({ scope, root, dir, env, home }) {
  const dirs = [];
  const add = (d) => { if (d && !dirs.includes(d)) dirs.push(d); };
  add(env.OPENCODE_CONFIG_DIR);
  add(path.join(xdg(env, home, 'XDG_CONFIG_HOME', '.config'), 'opencode'));
  const projectDirs = scope === 'project' ? [root, path.join(root, '.opencode')] : [];
  if (scope === 'global') add(dir);
  return [...dirs, ...projectDirs].flatMap((d) => [path.join(d, 'opencode.json'), path.join(d, 'opencode.jsonc')]);
}

/**
 * The custom providers the OpenCode configs define (`provider` V1, `providers` V2), the two
 * `*_providers` lists and the files read. `options` is never read: a key may sit there.
 */
export function readOpencodeConfig(ctx) {
  const providers = new Map();
  let enabled = null;
  const disabled = new Set();
  const files = [];
  for (const f of opencodeConfigFiles(ctx)) {
    const { state, data } = loadJsonObject(f);
    if (state !== 'ok') continue;
    files.push(f);
    for (const key of ['provider', 'providers']) {
      if (!isDict(data[key])) continue;
      for (const [id, p] of Object.entries(data[key])) {
        if (id === '__proto__' || !isDict(p)) continue;
        const baseURL = text(p.options?.baseURL) ?? text(p.options?.baseUrl) ?? text(p.baseURL);
        providers.set(id, { id, name: text(p.name) ?? id, baseURL, models: isDict(p.models) ? p.models : {}, file: path.basename(f) });
      }
    }
    if (Array.isArray(data.enabled_providers)) enabled = new Set(data.enabled_providers.filter((x) => typeof x === 'string'));
    if (Array.isArray(data.disabled_providers)) for (const x of data.disabled_providers) if (typeof x === 'string') disabled.add(x);
  }
  for (const id of [...providers.keys()]) if (disabled.has(id) || (enabled && !enabled.has(id))) providers.delete(id);
  return { providers, enabled, disabled, files };
}

async function opencodeModels(ctx, add, group) {
  const { env, home, fetchFn } = ctx;
  const cfg = readOpencodeConfig(ctx);
  const catFile = env.OPENCODE_MODELS_PATH || path.join(xdg(env, home, 'XDG_CACHE_HOME', '.cache'), 'opencode', 'models.json');
  const catalogue = isFile(catFile) ? readJson(catFile) : null;
  for (const p of cfg.providers.values()) {
    const note = `configured in ${p.file}`;
    group({ provider: p.id, providerName: p.name, source: 'config', note, local: false });
    for (const [mid, m] of Object.entries(p.models)) {
      if (mid === '__proto__') continue;
      const r = row(`${p.id}/${mid}`, { provider: p.id, providerName: p.name, source: 'config', note, local: false }, { name: mid, ...(isDict(m) ? m : {}) });
      add(enrich(r, catalogue?.[p.id]?.models?.[mid]));
    }
  }
  if (catalogue) {
    const auth = readJson(path.join(xdg(env, home, 'XDG_DATA_HOME', '.local/share'), 'opencode', 'auth.json'));
    for (const [pid, p] of Object.entries(catalogue)) {
      if (pid === '__proto__' || !isDict(p) || cfg.providers.has(pid) || cfg.disabled.has(pid)) continue;
      if (cfg.enabled && !cfg.enabled.has(pid)) continue;
      const saved = !!auth && Object.hasOwn(auth, pid);
      const envKey = Array.isArray(p.env) && p.env.some((n) => typeof n === 'string' && String(env[n] ?? '').trim());
      if (!saved && !envKey) continue;
      const note = `catalogue · ${saved ? 'credentials saved' : 'key found'}`;
      const name = text(p.name) ?? pid;
      group({ provider: pid, providerName: name, source: 'catalogue', note, local: false });
      for (const [mid, m] of Object.entries(isDict(p.models) ? p.models : {})) {
        if (!isDict(m) || m.status === 'alpha' || m.status === 'deprecated') continue;
        add(row(`${pid}/${mid}`, { provider: pid, providerName: name, source: 'catalogue', note, local: false }, { name: mid, ...m }));
      }
    }
  }
  for (const rt of await localRuntimes(fetchFn)) {
    if (cfg.disabled.has(rt.id)) continue;
    const up = rt.ids !== null;
    group({ provider: rt.id, providerName: rt.name, source: 'local', note: up ? 'local · running' : 'local · not running', local: true, available: up, ...(up ? {} : { reason: `${rt.name} not running` }) });
    for (const id of rt.ids ?? []) add(row(`${rt.id}/${id}`, { provider: rt.id, providerName: rt.name, source: 'local', note: 'local · running', local: true }, { name: id }));
  }
  return cfg;
}

// ---- OpenClaude ----------------------------------------------------------------------------------

const on = (v) => { const s = String(v ?? '').trim().toLowerCase(); return s !== '' && s !== '0' && s !== 'false'; };
const PROFILE_KEYS = ['CLAUDE_CODE_USE_OPENAI', 'CLAUDE_CODE_USE_GEMINI', 'CLAUDE_CODE_USE_MISTRAL', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'GEMINI_MODEL', 'MISTRAL_MODEL'];
const KEY_VARS = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'MISTRAL_API_KEY'];

/** The active OpenClaude provider: env first, then `.openclaude-profile.json`, then `.openclaude.json`. */
function openclaudeActive({ env, home }) {
  const configHome = env.OPENCLAUDE_CONFIG_DIR || path.join(home, '.openclaude');
  const pf = readJson(path.join(configHome, '.openclaude-profile.json'));
  const fileEnv = isDict(pf?.env) ? pf.env : {};
  // Named keys only; the secrets that file holds stay where they are, reduced to one boolean.
  const get = (k) => (text(env[k]) ?? text(fileEnv[k]));
  const settled = Object.fromEntries(PROFILE_KEYS.map((k) => [k, get(k)]));
  const prof = readJson(path.join(env.OPENCLAUDE_CONFIG_DIR || home, '.openclaude.json'));
  const entry = Array.isArray(prof?.providerProfiles)
    ? prof.providerProfiles.find((p) => isDict(p) && p.id === prof.activeProviderProfileId) : null;
  const flag = on(settled.CLAUDE_CODE_USE_OPENAI) ? 'openai' : on(settled.CLAUDE_CODE_USE_GEMINI) ? 'gemini'
    : on(settled.CLAUDE_CODE_USE_MISTRAL) ? 'mistral' : null;
  const kind = flag ?? (text(entry?.provider) && entry.provider !== 'anthropic' ? entry.provider : null);
  const modelVar = { openai: 'OPENAI_MODEL', gemini: 'GEMINI_MODEL', mistral: 'MISTRAL_MODEL' }[flag];
  return {
    configHome, kind, anthropic: kind === null,
    model: (modelVar ? settled[modelVar] : null) ?? text(entry?.model) ?? null,
    baseUrl: settled.OPENAI_BASE_URL ?? text(entry?.baseUrl) ?? null,
    hasKey: KEY_VARS.some((k) => !!get(k)) || !!entry?.apiKey,
  };
}

async function openclaudeModels(ctx, add, group) {
  const { fetchFn, dir } = ctx;
  const a = openclaudeActive(ctx);
  // The company's own names: the OpenCode custom provider on the same endpoint (never called).
  const want = normalizeUrl(a.baseUrl);
  if (want) {
    for (const p of readOpencodeConfig(ctx).providers.values()) {
      if (normalizeUrl(p.baseURL) !== want) continue;
      const note = `same endpoint as OpenCode provider ${p.id}`;
      group({ provider: p.id, providerName: p.name, source: 'config', note, local: false });
      for (const [mid, m] of Object.entries(p.models)) {
        if (mid !== '__proto__') add(row(mid, { provider: p.id, providerName: p.name, source: 'config', note, local: false }, isDict(m) ? m : {}));
      }
    }
  }
  if (a.model) {
    const p = a.kind ?? 'provider';
    group({ provider: p, providerName: a.kind ?? 'Active provider', source: 'provider', note: 'active provider', local: false });
    add(row(a.model, { provider: p, providerName: a.kind ?? 'Active provider', source: 'provider', note: 'active provider', local: isLocalUrl(a.baseUrl), available: a.hasKey || isLocalUrl(a.baseUrl), reason: 'no key found' }));
  }
  if (isLocalUrl(a.baseUrl)) {
    for (const rt of await localRuntimes(fetchFn)) {
      const up = rt.ids !== null;
      group({ provider: rt.id, providerName: rt.name, source: 'local', note: up ? 'local · running' : 'local · not running', local: true, available: up, ...(up ? {} : { reason: `${rt.name} not running` }) });
      for (const id of rt.ids ?? []) add(row(id, { provider: rt.id, providerName: rt.name, source: 'local', note: 'local · running', local: true }));
    }
  }
  const seen = new Set();
  for (const d of [a.configHome, dir]) {
    if (!d || seen.has(d)) continue;
    seen.add(d);
    const { state, data } = loadJsonObject(path.join(d, 'settings.json'));
    if (state !== 'ok' || !isDict(data.agentModels)) continue;
    group({ provider: 'route', providerName: 'Routes', source: 'route', note: 'route', local: false });
    for (const k of Object.keys(data.agentModels)) {
      if (k !== '__proto__') add(row(k, { provider: 'route', providerName: 'Routes', source: 'route', note: 'route', local: false }));
    }
  }
  if (a.anthropic) {
    group({ provider: 'anthropic', providerName: 'Anthropic aliases', source: 'alias', note: 'Anthropic aliases', local: false });
    for (const [id, name] of [...CLAUDE_ALIASES.slice(0, 3)]) add(row(id, { provider: 'anthropic', providerName: 'Anthropic aliases', source: 'alias', note: 'Anthropic aliases', local: false }, { name }));
  }
}

// ---- Claude Code ---------------------------------------------------------------------------------

/** `availableModels` of the install's settings (local over shared), or null when none is set. */
function claudeAvailable({ dir }) {
  let list = null;
  for (const f of ['settings.json', 'settings.local.json']) {
    const { state, data } = loadJsonObject(path.join(dir, f));
    if (state === 'ok' && Array.isArray(data.availableModels)) list = data.availableModels.filter((x) => typeof x === 'string').map((x) => x.trim().toLowerCase()).filter(Boolean);
  }
  return list;
}

/** An alias is allowed by an entry that is the family, or a version/full id of it. */
const aliasAllowed = (alias, list) => list === null || list.some((e) => e === alias || e.startsWith(`${alias}-`) || e.startsWith(`claude-${alias}`) || e.startsWith(`${alias}[`));

function claudeModels(ctx, add, group) {
  const list = claudeAvailable(ctx);
  const base = { provider: 'anthropic', providerName: 'Claude Code aliases', source: 'alias', note: list ? 'aliases allowed by availableModels' : 'Claude Code aliases', local: false };
  group(base);
  for (const [id, name] of CLAUDE_ALIASES) if (aliasAllowed(id, list)) add(row(id, base, { name }));
  for (const e of list ?? []) {
    if (CLAUDE_ALIASES.some(([a]) => e === a || e.startsWith(`${a}-`) || e.startsWith(`claude-${a}`))) continue;
    add(row(e, { ...base, note: 'availableModels' }));
  }
}

/**
 * `{ models, groups, notes }` for one install. `ctx`: `{ host, scope, dir, root, inUse?, env?, home?,
 * fetchFn? }`: `dir` the install's config dir, `inUse` the model ids its `agent-overrides.json` holds.
 */
export async function readModelCatalog(ctx0) {
  const ctx = { env: process.env, home: os.homedir(), fetchFn: globalThis.fetch, inUse: [], ...ctx0 };
  const models = [];
  const ids = new Set();
  const groups = [];
  const add = (r) => { if (!ids.has(r.id)) { ids.add(r.id); models.push(r); } };
  const group = (g) => { if (!groups.some((x) => x.provider === g.provider && x.note === g.note)) groups.push(g); };
  group({ ...SESSION, note: 'inherit', local: false, available: true });
  add({ id: 'inherit', name: 'Session model (inherit)', ...SESSION, note: 'inherit', local: false, available: true });
  if (ctx.host === 'claude') claudeModels(ctx, add, group);
  else if (ctx.host === 'opencode') await opencodeModels(ctx, add, group);
  else if (ctx.host === 'openclaude') await openclaudeModels(ctx, add, group);
  const listed = new Set(ids);
  const inUse = [...new Set(ctx.inUse.filter((x) => typeof x === 'string' && x.trim()))];
  if (inUse.length) group({ provider: 'in-use', providerName: 'In use', source: 'in-use', note: 'written in agent-overrides.json', local: false, available: true });
  for (const id of inUse) {
    models.push({ id, name: id, provider: 'in-use', providerName: 'In use', source: 'in-use', note: 'written in agent-overrides.json', local: false, available: true, detected: listed.has(id) });
  }
  return { models, groups };
}
