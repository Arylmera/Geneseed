/**
 * Is the official superpowers plugin installed on this machine? Read-only and best-effort.
 *
 * FILES ONLY, NEVER A PROCESS. `geneseed` may not start a process (a transitive `child_process` ban), and
 * the plugin managers each hold their state in a file, so the answer is a file read. The answer
 * is therefore one of two sentences, "seen in <file>" or "not seen in <files read>", and never
 * "not enabled": a settings file can say `false` while the desktop app loads the plugin (the
 * app keeps its own state under `rpm/`, undocumented, which is why that file is read last and
 * labelled as app state).
 *
 * NOT ON THE HOOK PATH. `bin/geneseed-hook.mjs` never imports this: a detection costs file
 * reads, and the hook's stdout is a signal channel (AGENTS.md, "What bites").
 *
 * EVERY ROOT IS A PARAMETER. A test passes fixture roots and never the machine's own; only the
 * default arguments (`defaultRoots`) read `$HOME`, the environment and the platform.
 */
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readText } from '../lib/fs.mjs';
import { readJsonc } from '../lib/json.mjs';

/** The plugin's repository, as the desktop app's manifest records it (`upstreamRepoUrl`). */
export const SUPERPOWERS_REPO_URL = 'https://github.com/obra/superpowers';

/** Hosts whose plugin store this module can read; any other host has no plugin to look for. */
export const DETECTABLE_HOSTS = ['claude', 'opencode'];

/**
 * The roots a real machine reads from. Called only when the caller names none.
 * @param {{ env?: NodeJS.ProcessEnv, home?: string, platform?: string }} [from]
 */
export function defaultRoots({ env = process.env, home = os.homedir(), platform = process.platform } = {}) {
  const appData = platform === 'win32' ? env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
    : platform === 'darwin' ? path.join(home, 'Library', 'Application Support')
      : env.XDG_CONFIG_HOME ?? path.join(home, '.config');
  return {
    claudeDir: env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'),
    opencodeDir: env.OPENCODE_CONFIG_DIR || path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode'),
    appDataDir: appData,
  };
}

/** A settings file as an object: null when it is absent or unparseable (a miss, never an error). */
function readObject(file) {
  try {
    const [data] = readJsonc(readText(file));
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch { return null; }
}

const isSuperpowersKey = (k) => /^superpowers(@|$)/.test(String(k));

/** Claude Code: `enabledPlugins` holds a `superpowers@<marketplace>` key set to true. */
function claudeSettingsSee(data) {
  const plugins = data?.enabledPlugins;
  return plugins !== null && typeof plugins === 'object'
    && Object.entries(plugins).some(([k, v]) => isSuperpowersKey(k) && v === true);
}

/** The desktop manifest: a `plugins` entry (or the file itself) whose `upstreamRepoUrl` is the plugin's repository. */
function manifestSees(d) {
  const same = (u) => typeof u === 'string' && u.replace(/(\.git)?\/*$/, '').toLowerCase() === SUPERPOWERS_REPO_URL;
  return same(d?.upstreamRepoUrl) || (Array.isArray(d?.plugins) && d.plugins.some((e) => same(e?.upstreamRepoUrl)));
}

/** OpenCode: `plugin` (V1) or `plugins` (V2) lists, or holds, a `superpowers@…` entry. */
function opencodeConfigSees(data) {
  for (const key of ['plugin', 'plugins']) {
    const v = data?.[key];
    const names = Array.isArray(v) ? v.map((e) => (Array.isArray(e) ? e[0] : e)) : v && typeof v === 'object' ? Object.keys(v) : [];
    if (names.some((n) => typeof n === 'string' && isSuperpowersKey(n))) return true;
  }
  return false;
}

/** The desktop app's plugin manifests: two folders below `<appData>/Claude/rpm`, each a `manifest.json`. */
function desktopManifests(appDataDir) {
  const root = path.join(appDataDir, 'Claude', 'rpm');
  const out = [];
  try {
    for (const a of readdirSync(root, { withFileTypes: true })) {
      if (!a.isDirectory()) continue;
      for (const b of readdirSync(path.join(root, a.name), { withFileTypes: true })) {
        const f = path.join(root, a.name, b.name, 'manifest.json');
        if (b.isDirectory() && existsSync(f)) out.push(f);
      }
    }
  } catch { /* no rpm folder: no desktop app state to read */ }
  return out.sort();
}

/**
 * Look for the superpowers plugin for `host`. `{ seen, where, read, state }`: `where` the first
 * file that showed it (null when none did), `read` every file looked at, `state` true when the
 * evidence is the desktop app's own state rather than a settings file. A host with no plugin
 * store to read (Bob, OpenClaude, the bundle) answers `{ seen: false, read: [], supported: false }`.
 * @param {string} host
 * @param {{ claudeDir?: string, opencodeDir?: string, appDataDir?: string, projectDir?: string | null }} [roots]
 */
export function detectSuperpowers(host, roots = {}) {
  if (!DETECTABLE_HOSTS.includes(host)) return { seen: false, where: null, read: [], state: false, supported: false };
  const r = { ...defaultRoots(), ...roots };
  const read = [];
  const look = (files, sees) => {
    for (const f of files) {
      if (!existsSync(f)) continue;
      read.push(f);
      if (sees(readObject(f))) return f;
    }
    return null;
  };
  let where = null;
  let state = false;
  if (host === 'claude') {
    where = look([
      path.join(r.claudeDir, 'settings.json'), path.join(r.claudeDir, 'settings.local.json'),
      ...(r.projectDir ? [path.join(r.projectDir, '.claude', 'settings.json'), path.join(r.projectDir, '.claude', 'settings.local.json')] : []),
    ], claudeSettingsSee);
    if (!where) {
      where = look(desktopManifests(r.appDataDir), manifestSees);
      state = where !== null;
    }
  } else {
    where = look([
      path.join(r.opencodeDir, 'opencode.json'), path.join(r.opencodeDir, 'opencode.jsonc'),
      ...(r.projectDir ? [path.join(r.projectDir, 'opencode.json'), path.join(r.projectDir, 'opencode.jsonc')] : []),
    ], opencodeConfigSees);
  }
  return { seen: where !== null, where, read, state, supported: true };
}

/** The one-line account of a detection, naming the file: never "not enabled". */
export function describeDetection(d) {
  if (!d.supported) return 'no plugin store to read on this host';
  if (d.seen) return `seen in ${d.where}${d.state ? ' (desktop app state, best-effort)' : ''}`;
  return `not seen in ${d.read.length ? d.read.join(', ') : 'any settings file (none found)'}`;
}

/**
 * A kit named in a profile's `kitsByDetection`, resolved: on when the plugin is NOT seen (the kit
 * stands in for it), off when it is. A host with no plugin store (Bob, OpenClaude) has nothing to
 * stand in for it, so the kit is on there. The wizard's default and the profile apply share this.
 * @param {string} host
 * @param {Parameters<typeof detectSuperpowers>[1]} [roots]
 */
export function superpowersKitDefault(host, roots = {}) {
  const d = detectSuperpowers(host, roots);
  return { on: !d.seen, detection: d, line: describeDetection(d) };
}
