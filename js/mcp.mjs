/**
 * MCP server presets, state and config I/O — `rituals/_harness_mcp.py`'s MCP block.
 *
 * WHAT THE PLAN SAID AND WHAT READING FOUND. The P6f plan scored `api_mcp` + `api_mcp_toggle`
 * at "~90 new, already in js/: `_mcp_load`/`readJsonc` (P6c), `settings.mjs`'s atomic write".
 * Measured against `js/`: `readJsonc` had crossed and NOTHING ELSE HAD. `js/web/api.mjs`
 * carries a five-line `mcpLoad` that is the no-host, comment-tolerant reader P6c needed for
 * `wiki.jsonc`, which is one arm of one of these thirteen functions. `_MCP_PRESETS`,
 * `_mcp_servers_key`, `_mcp_preset_block`, `_mcp_apply`, `_mcp_state`, `_mcp_set_enabled`,
 * `_mcp_load`'s host fork, `_mcp_commented`, `_mcp_save`, `_mcp_config_for`,
 * `_mcp_install_targets`, `_mcp_known_names` and `_mcp_meta` are 168 lines of Python, all
 * new. The endpoints on top of them are the small half.
 *
 * AND `settings.mjs`'s ATOMIC WRITE IS NOT THIS ONE. `atomicWriteJson` is
 * `_build_settings._atomic_write_json`; `_mcp_save` is a different function with a different
 * temp suffix (`.tmp`, not `.geneseed-tmp`) that also creates the parent directory. Reusing
 * the first would be right until the moment a write fails, which is the moment the temp
 * file's name becomes the only evidence of what happened.
 *
 * THE ROUND TRIP IS THE HAZARD, and it is why every read here goes through `parseJson`.
 * `_mcp_save` rewrites the WHOLE config, not the servers map — and for a Claude global
 * install that config is `~/.claude.json`, which holds projects and history far beyond MCP
 * wiring. A `JSON.parse` would turn every `"temperature": 1.0` in somebody's real file into
 * `1` on the way back out. `readJsonc` already learned this; the strict-JSON fork has to
 * learn it separately, because it does not go through `readJsonc` at all.
 *
 * A PyNumber IS AN OBJECT TO `typeof`, which is why `isDict` is spelled out rather than
 * written as `typeof v === 'object'`. Python's `isinstance(x, dict)` is false for a float;
 * the JS twin has to be false for its wrapper.
 */
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { bobConfigDir, copilotConfigDir, pyResolve } from './hosts.mjs';
import { installTargets } from './installs.mjs';
import { jsonDumpsIndent, parseJson, readText, writeText } from './lib/pyfs.mjs';
import { opencodeTarget, readJsonc } from './settings.mjs';

/**
 * `isinstance(x, dict)` for a value that came out of `json.loads`.
 *
 * A JSON value is null, a boolean, a string, a NUMBER, an array or an object — and
 * `parseJson` hands numbers back wrapped, so `typeof v === 'object'` says yes to a float.
 * `constructor === Object` is the plain-object test, and every object `JSON.parse` builds
 * is one.
 */
const isDict = (v) => v !== null && v !== undefined && typeof v === 'object'
  && v.constructor === Object;

/** `dict.get(key, default)`. */
const dget = (obj, key, dflt) => (isDict(obj) && Object.hasOwn(obj, key) ? obj[key] : dflt);

/** The hosts whose MCP config is strict JSON under `mcpServers`, with no `enabled` flag. */
const FLAGLESS = ['claude', 'bob', 'copilot'];

/**
 * `_harness_mcp._MCP_PRESETS` — the ready-to-wire servers the MCP screen can toggle.
 *
 * The `desc` strings go on the wire verbatim (`api_mcp` returns them), so they are the one
 * place in this file where a byte matters more than the shape. Insertion order is the
 * listing order.
 */
export const MCP_PRESETS = {
  markitdown: {
    label: 'MarkItDown',
    desc: 'PDF / Office / HTML -> Markdown for the ingest skill. Runs via `uvx` '
      + '(needs uv; zero-install, fetches on first call). No uv? Switch the command '
      + 'to ["markitdown-mcp"] after `pipx install markitdown-mcp`. Exposes one '
      + 'tool: convert_to_markdown(uri).',
    block: { type: 'local', command: ['uvx', 'markitdown-mcp'], enabled: true },
  },
  gitlab: {
    label: 'GitLab',
    desc: 'GitLab repo / MR / issue / CI tools via @zereight/mcp-gitlab (npx, no '
      + 'install). Edit GITLAB_PERSONAL_ACCESS_TOKEN (scopes: api, read_repository) '
      + 'and GITLAB_API_URL before use. Add a second entry (gitlab-2) for another '
      + 'instance.',
    block: {
      type: 'local',
      command: ['npx', '-y', '@zereight/mcp-gitlab'],
      environment: { GITLAB_PERSONAL_ACCESS_TOKEN: '',
        GITLAB_API_URL: 'https://gitlab.com/api/v4' },
      enabled: true,
    },
  },
  'gitlab-2': {
    label: 'GitLab (2nd instance)',
    desc: 'A second GitLab instance (e.g. a self-hosted server) via the same '
      + '@zereight/mcp-gitlab command. Point GITLAB_API_URL at the other instance '
      + "and give it that instance's own token.",
    block: {
      type: 'local',
      command: ['npx', '-y', '@zereight/mcp-gitlab'],
      environment: { GITLAB_PERSONAL_ACCESS_TOKEN: '',
        GITLAB_API_URL: 'https://gitlab.example.com/api/v4' },
      enabled: true,
    },
  },
  filesystem: {
    label: 'Filesystem',
    desc: 'Read/write files under explicitly allowed directories via '
      + '@modelcontextprotocol/server-filesystem (npx, no install). Replace the '
      + 'trailing path arg(s) with only the dir(s) the agent may touch '
      + '(least-privilege).',
    block: {
      type: 'local',
      command: ['npx', '-y', '@modelcontextprotocol/server-filesystem',
        '/path/to/allowed/dir'],
      enabled: true,
    },
  },
};

/** `_mcp_servers_key` — OpenCode nests servers under `mcp`, the other three `mcpServers`. */
const serversKey = (host) => (FLAGLESS.includes(host) ? 'mcpServers' : 'mcp');

/** `(config.get(key) or {})` — the servers map, or an empty one. */
const serversOf = (config, host) => {
  const s = dget(config, serversKey(host), null);
  return isDict(s) ? s : {};
};

/**
 * `_mcp_preset_block` — the block to WRITE for a preset, shaped for `host`.
 *
 * OpenCode takes it verbatim. The flagless three split the command list into `command`
 * (head) + `args` (tail) and rename `environment` to `env`; Copilot additionally requires
 * `type` and a `tools` allowlist.
 */
export function mcpPresetBlock(name, host = 'opencode') {
  const block = { ...MCP_PRESETS[name].block };
  if (!FLAGLESS.includes(host)) return block;
  const cmd = [...(block.command || [])];
  const out = { command: cmd.length ? cmd[0] : '', args: cmd.slice(1) };
  const env = block.environment;
  if (env) out.env = { ...env };
  if (host === 'copilot') {
    out.type = 'local';
    out.tools = ['*'];
  }
  return out;
}

/**
 * `_mcp_apply` — a COPY of `config` with server `name` set to `block`, or removed when
 * `block` is null. Never touches another key; drops an emptied servers map.
 *
 * The key ORDER is behaviour, not cosmetics: `setdefault` appends `$schema` at the end of a
 * fresh dict and leaves an existing one where it is, and `_mcp_save` writes the result out
 * as the file the user then reads. `{...config}` plus a guarded assignment is the same rule.
 */
export function mcpApply(config, name, block, host = 'opencode') {
  const cfg = { ...config };
  const key = serversKey(host);
  if (host === 'opencode' && !Object.hasOwn(cfg, '$schema')) {
    cfg.$schema = 'https://opencode.ai/config.json';
  }
  const servers = { ...serversOf(cfg, host) };
  if (block === null) delete servers[name];
  else servers[name] = block;
  if (Object.keys(servers).length) cfg[key] = servers;
  else delete cfg[key];
  return cfg;
}

/**
 * `_mcp_state` — 'enabled' | 'disabled' | 'absent'.
 *
 * OpenCode: a present server with no explicit `enabled` counts as enabled (its default).
 * The flagless three have no such key, so present IS enabled and 'disabled' never occurs —
 * toggling one off removes its entry instead.
 */
export function mcpState(config, name, host = 'opencode') {
  const server = serversOf(config, host)[name];
  if (!isDict(server)) return 'absent';
  if (FLAGLESS.includes(host)) return 'enabled';
  return dget(server, 'enabled', true) ? 'enabled' : 'disabled';
}

/** `_mcp_set_enabled` — flip a present server's enabled-ness. No-op when it is absent. */
export function mcpSetEnabled(config, name, enabled, host = 'opencode') {
  const server = serversOf(config, host)[name];
  if (!isDict(server)) return config;
  if (FLAGLESS.includes(host)) {
    return enabled ? config : mcpApply(config, name, null, host);
  }
  return mcpApply(config, name, { ...server, enabled }, host);
}

/**
 * `_mcp_load` — a config as a dict; `{}` when missing, unreadable, unparseable or not an
 * object.
 *
 * The host fork is the whole function. OpenCode is read comment-tolerantly because a
 * hand-maintained `opencode.jsonc` carries `//`; the other three are read STRICTLY, because
 * the comment stripper's trailing-comma pass is not string-aware and would silently drop a
 * comma from any string value containing `,]` — in a file that holds projects and history.
 */
export function mcpLoad(p, host = 'opencode') {
  if (!existsSync(p)) return {};
  let text;
  try {
    text = readText(p);
  } catch {
    return {};
  }
  if (FLAGLESS.includes(host)) {
    let data;
    try {
      data = parseJson(text);
    } catch {
      return {};
    }
    return isDict(data) ? data : {};
  }
  const [data] = readJsonc(text);
  return isDict(data) ? data : {};
}

/** `_mcp_commented` — an existing `.jsonc` that carries comments, which must not be rewritten. */
export function mcpCommented(p) {
  if (path.extname(p) !== '.jsonc' || !existsSync(p)) return false;
  try {
    const [, had] = readJsonc(readText(p));
    return had;
  } catch {
    return false;
  }
}

/**
 * `_mcp_save` — pretty JSON, written ATOMICALLY through a sibling temp file.
 *
 * Not `atomicWriteJson`: that is `_build_settings._atomic_write_json`, whose temp file is
 * named `.geneseed-tmp` and which does not create the parent directory. Two Python
 * functions, two twins.
 */
export function mcpSave(p, config) {
  mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  writeText(tmp, `${jsonDumpsIndent(config)}\n`);
  renameSync(tmp, p);
}

/**
 * `_mcp_config_for` — the file an install writes its MCP servers into, or null for a host
 * that carries no MCP wiring at that scope.
 */
export function mcpConfigFor(host, scope, root) {
  if (host === 'opencode') return opencodeTarget(path.join(root, 'opencode.json'));
  if (host === 'claude') {
    return scope === 'project' ? path.join(root, '.mcp.json')
      : pyResolve(path.join(os.homedir(), '.claude.json'));
  }
  if (host === 'bob') {
    return scope === 'project' ? path.join(root, '.bob', 'settings.json')
      : path.join(bobConfigDir(), 'settings.json');
  }
  if (host === 'copilot') {
    // The Copilot CLI reads MCP servers from ~/.copilot/mcp-config.json only — no per-repo
    // file is documented, so a project install carries no MCP wiring.
    return scope === 'global' ? path.join(copilotConfigDir(), 'mcp-config.json') : null;
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

/** `_mcp_known_names` — the presets first, then any server already in THIS config. */
export function mcpKnownNames(config, host = 'opencode') {
  const names = Object.keys(MCP_PRESETS);
  const present = isDict(config) ? Object.keys(serversOf(config, host)) : [];
  return names.concat(present.filter((n) => !Object.hasOwn(MCP_PRESETS, n)));
}

/** `_mcp_meta` — (label, description); the bare name and a generic note for an unknown one. */
export function mcpMeta(name) {
  const p = MCP_PRESETS[name];
  if (p) return [p.label, p.desc];
  return [name, 'User-defined MCP server (not a Harness preset). It lives in this '
    + "config already — 'e' enables/disables it, Enter removes it."];
}

export { isDict };
