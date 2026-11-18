/**
 * The console's view of the sub-agent models — `GET`/`POST /api/agent-models`.
 *
 * What it reads and writes is `agent-overrides.json` of ONE Claude Code install: the `tiers` map
 * (`standard`, `light`) and each agent's `agents.<name>.model` pin. The precedence (pin > map >
 * the tier's default > inherit) is `claudeAgentModel` in `js/hosts/native.mjs`, the same function
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
 * Pins and the map are Claude Code's: OpenCode records pins but this page does not edit them, and
 * a host that is not Claude Code answers each agent's tier and no model.
 */
import path from 'node:path';

import { renderAll } from '../build/render.mjs';
import { loadKits, makeCfg } from '../build/source.mjs';
import { EMIT_HOST_SCOPE, tiersOfDir } from '../hosts/installs.mjs';
import {
  CLAUDE_TIER_DEFAULTS, claudeAgentModel, loadAgentOverrides, loadTierMap, overrideProblem,
} from '../hosts/native.mjs';
import { isFile, readText, withDiscardableStderr, writeTextAtomic } from '../lib/fs.mjs';
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

/** The view's host and the install's directory; `claude` false for every host but Claude Code. */
function viewOf(state) {
  const [host] = EMIT_HOST_SCOPE.get(state.emit || '') ?? ['opencode'];
  return { host, claude: host === 'claude', dir: state.target };
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
  // The loaders warn on stderr about a bad entry; a console read says nothing, the page does.
  const map = problem ? {} : withDiscardableStderr(() => loadTierMap(dir, () => {}));
  const pins = problem ? {} : withDiscardableStderr(() => loadAgentOverrides(dir));
  const on = tiers === 'auto' ? { map, env } : null;
  const warnings = new Set();
  const agents = names.map((name) => {
    const tier = known.get(name) ?? null;
    const pin = Object.hasOwn(pins, name) && isTruthy(pins[name]?.model) ? formatValue(pins[name].model) : null;
    // A personal agent (no shipped source) is not Geneseed's to tier: only its pin counts.
    const r = claudeAgentModel(tier ?? 'none', pin, tier ? on : null);
    if (r.warning) warnings.add(r.warning);
    return { name, tier, pin, model: r.model, from: r.from };
  });
  return {
    host, claude, tiers, file: { path: file, problem },
    map: Object.fromEntries(Object.entries(map).map(([k, v]) => [k, formatValue(v)])),
    defaults: { ...CLAUDE_TIER_DEFAULTS },
    warnings: [...warnings], agents,
  };
}

/**
 * Apply one edit to the parsed file in place; the problems found, none applied when there are some.
 * `edit` is `{ tiers?: {standard?, light?}, agents?: {<name>: model} }`, `names` the installed agents.
 */
export function editOverrides(data, edit, names) {
  const problems = [];
  const asModel = (where, v) => {
    if (v === null) return null;
    if (typeof v !== 'string') { problems.push(`${where}: a model name, or null`); return undefined; }
    const s = v.trim();
    const why = overrideProblem(s);
    if (why) { problems.push(`${where} ${why}`); return undefined; }
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
  const { claude, dir } = viewOf(state);
  if (!claude) return { ok: false, error: 'Models are set on Claude Code installs only' };
  const { file, data, problem } = readOverrides(dir);
  if (problem) return { ok: false, error: problem };
  const names = state.inventory.agents.map((a) => a.name);
  const problems = editOverrides(data, { tiers: bget(body, 'tiers'), agents: bget(body, 'agents') }, names);
  if (problems.length) return { ok: false, error: problems.join('; ') };
  writeTextAtomic(file, `${jsonDumpsIndent(data, { ensureAscii: false })}\n`);
  return { ok: true, rebuild: true, ...apiAgentModels(state) };
}
