/**
 * MCP server state and config reading — `rituals/_harness_mcp.py`'s MCP block, minus its writers.
 *
 * READ-ONLY BY DECISION (2026-10). Which MCP servers an install wires depends on the user and on
 * the host, so Geneseed shows what each config already holds and where that file lives, and the
 * user edits it. The three presets (`MCP_PRESETS`), the block shaper, the applier, the
 * enable/disable flip and the atomic saver went with the console's Add button and toggle;
 * `docs/guides/mcp*.md` carry the blocks a user copies by hand. Nothing here writes.
 *
 * THE READ IS STILL HOST-SHAPED. OpenCode nests servers under `mcp` with an `enabled` flag and
 * may be `.jsonc`; the Claude-shaped three use `mcpServers`, are strict JSON, and have no flag —
 * present IS enabled. `uninstall` reads through `mcpLoad` too.
 *
 * A JsonNumber IS AN OBJECT TO `typeof`, which is why `isDict` (js/lib/json.mjs) excludes
 * the wrapper rather than testing `typeof v === 'object'`. Python's `isinstance(x, dict)` is
 * false for a float; the JS twin has to be false for its wrapper.
 */
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CLAUDE_STYLE, bobConfigDir, resolvePath } from './hosts.mjs';
import { installState, installTargets } from './installs.mjs';
import { printOut, printErr } from '../lib/fs.mjs';
import { isDict } from '../lib/json.mjs';
import { padEndToWidth } from '../lib/text.mjs';
import { loadJsonObject, opencodeTarget } from './settings.mjs';


/** `dict.get(key, default)`. */
const dget = (obj, key, dflt) => (isDict(obj) && Object.hasOwn(obj, key) ? obj[key] : dflt);

/** The hosts whose MCP config is strict JSON under `mcpServers`, with no `enabled` flag. */
const FLAGLESS = CLAUDE_STYLE;

/** `_mcp_servers_key` — OpenCode nests servers under `mcp`, the other three `mcpServers`. */
const serversKey = (host) => (FLAGLESS.includes(host) ? 'mcpServers' : 'mcp');

/** `(config.get(key) or {})` — the servers map, or an empty one. */
const serversOf = (config, host) => {
  const s = dget(config, serversKey(host), null);
  return isDict(s) ? s : {};
};

/**
 * `_mcp_state` — 'enabled' | 'disabled' | 'absent'.
 *
 * OpenCode: a present server with no explicit `enabled` counts as enabled (its default).
 * The flagless three have no such key, so present IS enabled and 'disabled' never occurs.
 */
export function mcpState(config, name, host = 'opencode') {
  const server = serversOf(config, host)[name];
  if (!isDict(server)) return 'absent';
  if (FLAGLESS.includes(host)) return 'enabled';
  return dget(server, 'enabled', true) ? 'enabled' : 'disabled';
}

/**
 * `_mcp_load` — a config as a dict; `{}` when missing, unreadable, unparseable or not an
 * object.
 *
 * The host fork is the whole function. OpenCode is read comment-tolerantly because a
 * hand-maintained `opencode.jsonc` carries `//`; the other three are read STRICTLY, because
 * their configs are plain JSON by contract. (The comment stripper's trailing-comma pass IS string-aware; an older
 * version of this note said otherwise, and `generate.test.mjs` pins the string-aware case.)
 */
export function mcpLoad(p, host = 'opencode') {
  const { state, data } = loadJsonObject(p, { strict: FLAGLESS.includes(host) });
  return state === 'ok' ? data : {};
}

/** `_mcp_commented` — an existing `.jsonc` that carries comments, which must not be rewritten. */
export function mcpCommented(p) {
  if (path.extname(p) !== '.jsonc') return false;
  return loadJsonObject(p).hadComments;
}

/**
 * `_mcp_config_for` — the file an install writes its MCP servers into, or null for a host
 * that carries no MCP wiring at that scope.
 */
export function mcpConfigFor(host, scope, root) {
  if (host === 'opencode') return opencodeTarget(path.join(root, 'opencode.json'));
  if (host === 'claude') {
    return scope === 'project' ? path.join(root, '.mcp.json')
      : resolvePath(path.join(os.homedir(), '.claude.json'));
  }
  if (host === 'bob') {
    // Bob reads MCP servers from their OWN file, never from settings.json: `.bob/mcp.json` in
    // the project, `~/.bob/settings/mcp.json` globally, each `{"mcpServers": …}`
    // (bob.ibm.com/docs/ide/configuration/mcp/mcp-in-bob). Servers written into settings.json,
    // as an older version did, never loaded.
    return scope === 'project' ? path.join(root, '.bob', 'mcp.json')
      : path.join(bobConfigDir(), 'settings', 'mcp.json');
  }
  if (host === 'openclaude') {
    // Claude's `.mcp.json` per repo; globally `.openclaude.json` beside the home dir, or
    // INSIDE `$OPENCLAUDE_CONFIG_DIR` when set — OpenClaude's own `getGlobalClaudeFile` rule.
    if (scope === 'project') return path.join(root, '.mcp.json');
    const env = process.env.OPENCLAUDE_CONFIG_DIR;
    return resolvePath(path.join(env || os.homedir(), '.openclaude.json'));
  }
  return null;
}

/** `_mcp_install_targets` — (label, configFile, host, scope, installRoot) per detected install. */
export function mcpInstallTargets() {
  const out = [];
  for (const [host, scope, root] of installTargets()) {
    const cfg = mcpConfigFor(host, scope, root);
    if (cfg !== null) out.push([`${scope} config`, cfg, host, scope, root]);
  }
  return out;
}

/** The servers THIS config already has, in file order. Nothing it could have. */
export function mcpServerNames(config, host = 'opencode') {
  return isDict(config) ? Object.keys(serversOf(config, host)) : [];
}

export { isDict };

// ---- the verb ----------------------------------------------------------------------------

/**
 * `geneseed mcp` — the servers each active install has wired, and the file they live in.
 *
 * The same `mcpInstallTargets` / `mcpLoad` / `mcpServerNames` / `mcpState` sequence the
 * console's read endpoint runs, rendered as text instead of as JSON. Read-only like the
 * console: there is nothing here to add or toggle a server with.
 */
export function cmdMcp() {
  const targets = mcpInstallTargets()
    .filter(([, , host, scope, root]) => installState(root, host, scope) === 'active');
  if (!targets.length) {
    printErr('[mcp] no active Geneseed install found. Run `geneseed setup` first.\n');
    return 1;
  }
  for (const [label, p, host] of targets) {
    const cfg = mcpLoad(p, host);
    printOut(`[mcp] ${host} ${label}: ${p}${existsSync(p) ? '' : ' (not written yet)'}\n`);
    if (mcpCommented(p)) {
      printOut('  this config carries comments — edit it by hand so they survive.\n');
    }
    const names = mcpServerNames(cfg, host);
    if (!names.length) printOut('  no MCP server configured\n');
    for (const name of names) {
      printOut(`  ${padEndToWidth(mcpState(cfg, name, host), 8)}  ${name}\n`);
    }
  }
  return 0;
}
