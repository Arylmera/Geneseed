/**
 * The console's view of the sub-agent models — `GET`/`POST /api/agent-models`.
 *
 * What it reads and writes is `agent-overrides.json` of ONE install (Claude Code, OpenCode or
 * OpenClaude; Bob takes no model): the `tiers` map (`standard`, `light`) and each agent's
 * `agents.<name>.model` pin. The precedence (pin > map > the host's tier default > inherit) is
 * `agentModel` in `js/hosts/native.mjs`, the same function
 * the emit writes agent frontmatter with, so this page can never promise a model the build will
 * not write. The value validation is `overrideProblem` and the map reader `loadTierMap`, there too.
 *
 * THE FILE IS THE USER'S. A write changes only the keys it names, key by key, in the order the
 * file already has; it refuses a file that does not parse, or a `tiers`/`agents` that is not an
 * object, rather than replace what it cannot read. Nothing here rebuilds: the model is written
 * into the agent files at emit, so a save answers `rebuild: true` and the page offers the rebuild
 * through the install action.
 *
 * A tier's value: a string sets it (`''` is the user choosing inherit, as `loadTierMap` reads it),
 * `null` removes the key (back to the tier's default). A pin: a string sets it, `''` or `null`
 * removes `model` and leaves the rest of the agent's entry alone.
 *
 * The GET also lists the models the install can run (`model-catalog.mjs`), and a save is validated
 * per host: OpenCode takes `provider/model[#variant]`, the others any single-line string. The
 * routing (`--tiers`) is not written here: the page sends it with the rebuild, through the existing
 * `install` action (its `tiers` field), so one path rebuilds. A host with no per-agent model (Bob)
 * answers each agent's tier and no model.
 */
import path from 'node:path';

import { renderAll } from '../build/render.mjs';
import { loadKits, makeCfg } from '../build/source.mjs';
import { EMIT_HOST_SCOPE, tiersOfDir } from '../hosts/installs.mjs';
import {
  TIER_DEFAULTS, agentModel, loadAgentOverrides, loadTierMap, overrideProblem,
} from '../hosts/native.mjs';
import { readModelCatalog } from './model-catalog.mjs';
import { isFile, readText, writeTextAtomic } from '../lib/fs.mjs';
import { formatValue, isDict, isTruthy, jsonDumpsIndent, parseJson } from '../lib/json.mjs';
import { bget } from './actions.mjs';

const FILE = 'agent-overrides.json';
/** The tiers that take a model; `strong` is the session's own and has no key. */
const MAP_TIERS = ['standard', 'light'];
const MAX_MODEL = 200;

let tierTable = null;
/**
 * `Map<agent name, 'strong'|'standard'|'light'>` off the SOURCE: the render strips an agent's
 * `<!-- tier: -->` line from every output, so an installed file cannot say it. Every kit's agents
 * are included, so a kit's seat is not read as `standard` by default. Built once per process.
 */
export function agentTiers() {
  if (tierTable) return tierTable;
  const out = new Map();
  const { items } = renderAll(makeCfg({ kits: [...loadKits().keys()] }), 'neutral');
  for (const { rel, tier = 'standard' } of items) {
    const m = /^agents\/([^_/][^/]*)\.md$/.exec(rel);
    if (m) out.set(m[1], tier);
  }
  tierTable = out;
  return out;
}

/** `{ exists, data, problem }`: the file parsed as an object, else why it cannot be edited. */
function readOverrides(dir) {
  const file = path.join(dir, FILE);
  if (!isFile(file)) return { file, exists: false, data: {}, problem: null };
  let data;
  try { data = parseJson(readText(file)); } catch {
    return { file, exists: true, data: null, problem: `${FILE} is not valid JSON (comments are not allowed) — fix it by hand` };
  }
  if (!isDict(data)) return { file, exists: true, data: null, problem: `${FILE} is not a JSON object — fix it by hand` };
  return { file, exists: true, data, problem: null };
}

/** The hosts whose agents take a `model:` line: every host but Bob. */
const ROUTES = ['claude', 'opencode', 'openclaude'];

/** The view's host, scope and the install's directory; `claude` (routing supported) false only for Bob. */
function viewOf(state) {
  const [host, scope] = EMIT_HOST_SCOPE.get(state.emit || '') ?? ['opencode', 'global'];
  return { host, scope, claude: ROUTES.includes(host), dir: state.target };
}

/** The model ids this install's `agent-overrides.json` holds: the tier map's values and the pins. */
function modelsInUse(dir) {
  const { data, problem } = readOverrides(dir);
  if (problem || !data) return [];
  const out = [];
  if (isDict(data.tiers)) for (const v of Object.values(data.tiers)) if (typeof v === 'string' && v.trim()) out.push(v.trim());
  if (isDict(data.agents)) for (const e of Object.values(data.agents)) if (isDict(e) && typeof e.model === 'string' && e.model.trim()) out.push(e.model.trim());
  return out;
}

/**
 * `GET /api/agent-models`: the per-agent view (`apiAgentModels`) plus the install's `models` and
 * `groups` (`readModelCatalog`: files and loopback probes, never a key). Async because of the probes.
 * `opts` (`env`, `home`, `fetchFn`) lets a test plant the machine.
 */
export async function apiAgentModelsFull(state, opts = {}) {
  const view = apiAgentModels(state, opts.env);
  const { host, scope, dir } = viewOf(state);
  if (!view.claude) return { ...view, models: [], groups: [] };
  const cat = await readModelCatalog({ host, scope, dir, root: state.root ?? dir, inUse: modelsInUse(dir), ...opts });
  return { ...view, ...cat };
}

export function apiAgentModels(state, env = process.env) {
  const { host, claude, dir } = viewOf(state);
  const tiers = tiersOfDir(state.root ?? dir, host);
  const known = agentTiers();
  const names = state.inventory.agents.map((a) => a.name);
  if (!claude) {
    return { host, claude, tiers, agents: names.map((name) => ({ name, tier: known.get(name) ?? null })) };
  }
  const { file, problem } = readOverrides(dir);
  // The loaders take a no-op reporter: a console read prints nothing on stderr.
  const quiet = () => {};
  const map = problem ? {} : loadTierMap(dir, quiet);
  const pins = problem ? {} : loadAgentOverrides(dir, quiet);
  const on = tiers === 'auto' ? { map, env, host } : null;
  const warnings = new Set();
  const agents = names.map((name) => {
    const tier = known.get(name) ?? null;
    const pin = Object.hasOwn(pins, name) && isTruthy(pins[name]?.model) ? formatValue(pins[name].model) : null;
    // A personal agent (no shipped source) is not Geneseed's to tier: only its pin counts.
    const r = agentModel(tier ?? 'none', pin, tier ? on : null);
    // The alias warning is the tier map's, whether or not the routing is installed yet: the
    // console's editor shows with a picked `auto`, before the rebuild that turns it on.
    const w = tier ? agentModel(tier, pin, { map, env, host }).warning : null;
    if (w) warnings.add(w);
    return { name, tier, pin, model: r.model, from: r.from };
  });
  return {
    host, claude, tiers, file: { path: file, problem },
    map: Object.fromEntries(Object.entries(map).map(([k, v]) => [k, formatValue(v)])),
    defaults: { ...TIER_DEFAULTS[host] },
    warnings: [...warnings], agents,
  };
}

/**
 * Apply one edit to the parsed file in place; the problems found, none applied when there are some.
 * `edit` is `{ tiers?: {standard?, light?}, agents?: {<name>: model} }`, `names` the installed agents.
 */
export function editOverrides(data, edit, names, host = 'claude') {
  const problems = [];
  const asModel = (where, v) => {
    if (v === null) return null;
    if (typeof v !== 'string') { problems.push(`${where}: a model name, or null`); return undefined; }
    const s = v.trim();
    const why = overrideProblem(s);
    if (why) { problems.push(`${where} ${why}`); return undefined; }
    // OpenCode names a model `provider/model[#variant]`: the provider ends at the first `/`.
    if (host === 'opencode' && s && !/^[^\s/]+\/[^\s]+$/.test(s)) {
      problems.push(`${where} must look like provider/model, with no whitespace`); return undefined;
    }
    if (s.length > MAX_MODEL) { problems.push(`${where} is longer than ${MAX_MODEL} characters`); return undefined; }
    return s;
  };
  const tiers = isDict(edit.tiers) ? edit.tiers : {};
  const agents = isDict(edit.agents) ? edit.agents : {};
  const tierOps = [];
  for (const [k, v] of Object.entries(tiers)) {
    if (!MAP_TIERS.includes(k)) { problems.push(`tiers.${k} is not a tier that takes a model (${MAP_TIERS.join(', ')})`); continue; }
    const m = asModel(`tiers.${k}`, v);
    if (m !== undefined) tierOps.push([k, m]);
  }
  const pinOps = [];
  for (const [name, v] of Object.entries(agents)) {
    if (name === '__proto__' || !names.includes(name)) { problems.push(`agents.${name} is not an installed agent`); continue; }
    const m = asModel(`agents.${name}.model`, v);
    if (m !== undefined) pinOps.push([name, m === '' ? null : m]);
  }
  if (!tierOps.length && !pinOps.length && !problems.length) problems.push('nothing to save');
  if (tierOps.length && Object.hasOwn(data, 'tiers') && !isDict(data.tiers)) problems.push(`${FILE}: "tiers" is not an object — fix it by hand`);
  if (pinOps.length && Object.hasOwn(data, 'agents') && !isDict(data.agents)) problems.push(`${FILE}: "agents" is not an object — fix it by hand`);
  if (problems.length) return problems;

  for (const [k, m] of tierOps) {
    if (m === null) { if (isDict(data.tiers)) delete data.tiers[k]; continue; }
    if (!isDict(data.tiers)) data.tiers = {};
    data.tiers[k] = m;
  }
  for (const [name, m] of pinOps) {
    if (m === null) {
      if (isDict(data.agents) && Object.hasOwn(data.agents, name) && isDict(data.agents[name])) delete data.agents[name].model;
      continue;
    }
    if (!isDict(data.agents)) data.agents = {};
    if (!Object.hasOwn(data.agents, name) || !isDict(data.agents[name])) data.agents[name] = {};
    data.agents[name].model = m;
  }
  return [];
}

/** `POST /api/agent-models`: `ok: false` (a 409) when nothing was written, with the reason. */
export function apiAgentModelsSave(state, body) {
  const { host, claude, dir } = viewOf(state);
  if (!claude) return { ok: false, error: 'This host takes no per-agent model (Bob), so there is nothing to save' };
  const { file, data, problem } = readOverrides(dir);
  if (problem) return { ok: false, error: problem };
  const names = state.inventory.agents.map((a) => a.name);
  const problems = editOverrides(data, { tiers: bget(body, 'tiers'), agents: bget(body, 'agents') }, names, host);
  if (problems.length) return { ok: false, error: problems.join('; ') };
  writeTextAtomic(file, `${jsonDumpsIndent(data, { ensureAscii: false })}\n`);
  return { ok: true, rebuild: true, ...apiAgentModels(state) };
}
