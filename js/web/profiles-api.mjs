/**
 * The console's Profiles tab (spec D38, D39): the read-only list of install profiles, what
 * applying one would change, and the two jobs that apply or save one.
 *
 * NOTHING HERE BUILDS. The list and the preview read profile files and install markers; the two
 * writes are a `{ cmd }` the job runner spawns, `geneseed profile apply|save …` — the same CLI path
 * a terminal takes, so the console cannot apply a profile any other way than the CLI does. Each
 * body is checked here first, so a bad one is a 400 and never a job that fails.
 *
 * `src` (the profile sources) and `tools` (the host detection) are the tests' seams: no test may
 * read the real machine tier's `profiles/`.
 */
import path from 'node:path';

import { ROOT } from '../build/source.mjs';
import { installProfile } from '../build/profile.mjs';
import { HOSTS } from '../hosts/hosts.mjs';
import { installState, installTargets } from '../hosts/installs.mjs';
import {
  BASE_PROFILE, isGitClone, listProfiles, loadProfile, profileBuildArgs, profileDiff, profileDirs,
  profileFromInstall, profileHosts,
} from '../maintain/profiles.mjs';
import { checkProjectFolder, globalLayering } from '../maintain/profile-scope.mjs';
import { hostTools, profileChanges } from '../maintain/setup.mjs';

/** A profile name, as `saveProfile` takes one: a file stem, never a path. */
const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;

/** `[host, scope, root]` of every active install, in `installTargets` order. */
function activeTargets() {
  return installTargets().filter(([h, s, r]) => installState(r, h, s) === 'active');
}

/**
 * Whether an install FOLLOWS a profile: its read-back equals the profile on every build setting.
 * `hosts`, `login` and `description` are no install setting, so they are never compared (else
 * `starter`, which lists four hosts, could match no install). `sharedTier` counts only on a
 * project install: a global apply ignores it (D37), so a global install cannot differ on it.
 */
export function followsProfile(installP, scope, p) {
  const skip = new Set(['hosts', 'login', ...(scope === 'global' ? ['sharedTier'] : [])]);
  return profileDiff(installP, p).every((d) => skip.has(d.key));
}

/** The hosts row of the tab: `{ host, label, present }` in HOSTS order. */
function hostRows(tools) {
  const labels = { opencode: 'OpenCode', claude: 'Claude Code', bob: 'IBM Bob', openclaude: 'OpenClaude' };
  const rows = tools();
  return profileHosts().map((host, i) => ({ host, label: labels[host] ?? host, present: Boolean(rows[i]?.[1]) }));
}

/**
 * What applying `p` would do per host, in one scope: `project` null is global. Each row names
 * the install there now (`state`), whether this machine has the tool, the settings its build
 * would change back (the preserve guard's own list, `profileChanges`), and in project scope the
 * global install that keeps running beside it (D39, `globalLayering`).
 */
function previewRows(p, project, hosts) {
  return hosts.filter((h) => p.hosts.includes(h.host)).map((h) => {
    let root = project;
    if (!project) {
      try { root = HOSTS.find((x) => x.host === h.host).configDir(); } catch { root = null; }
    }
    const state = root ? installState(root, h.host, project ? 'project' : 'global') : 'absent';
    const changes = h.present && state === 'active' ? profileChanges(profileBuildArgs(p, h.host, project)) : [];
    return {
      host: h.host, label: h.label, present: h.present, state, root: root ? String(root) : null,
      changes, layering: project ? globalLayering(h.host) : null,
    };
  });
}

/**
 * `GET /api/profiles[?profile=<name>[&project=<dir>]]` — machine-wide (`MACHINE_GETS`).
 *
 * `profiles`: every file of both sources, each with its source, file, validity, settings, the
 * gates it turns off, how it differs from `starter` and the active installs that follow it.
 * `installs`: every active install with the profiles it follows and its own difference from
 * `starter` (the Selected install panel's tag, the Save panel's preview). With `?profile=`, a
 * `preview` of applying it globally, or into `?project=` (a folder the Apply panel names).
 */
export function apiProfiles(state, url, { src = {}, tools = hostTools } = {}) {
  const q = new URL(url || '', 'http://x').searchParams;
  const dirs = profileDirs(src);
  const base = loadProfile(BASE_PROFILE, dirs);
  const readBacks = activeTargets().map(([host, scope, root]) => ({
    host, scope, path: String(root), profile: profileFromInstall(installProfile(host, scope, root)),
  }));
  /** @type {any[]} one row per file: a loaded profile carries `profile`, a refused one `error` */
  const profiles = listProfiles(dirs).map((e) => {
    const head = { name: e.name, source: e.source, file: e.file, shadowed: e.shadowed };
    if (e.shadowed) return { ...head, error: 'a shipped profile has this name, so this file is never loaded — rename it' };
    const r = loadProfile(e.name, dirs);
    if (!r.ok) return { ...head, error: r.error };
    const p = r.profile;
    return {
      ...head, description: p.description ?? '', profile: p,
      gatesOff: Object.keys(p.gates ?? {}),
      diff: base.ok ? profileDiff(p, base.profile) : [],
      matches: readBacks.filter((rb) => followsProfile(rb.profile, rb.scope, p))
        .map(({ host, scope, path: at }) => ({ host, scope, path: at })),
    };
  });
  const loaded = profiles.filter((x) => x.profile);
  const installs = readBacks.map((rb) => ({
    host: rb.host, scope: rb.scope, path: rb.path,
    matches: loaded.filter((x) => followsProfile(rb.profile, rb.scope, x.profile)).map((x) => x.name),
    diff: base.ok ? profileDiff(rb.profile, base.profile) : [],
  }));
  const hosts = hostRows(tools);
  const out = {
    profiles, installs, hosts, base: BASE_PROFILE, personalDir: dirs.personalDir,
    shippedDir: dirs.shippedDir, shippedWritable: isGitClone(),
  };
  const name = q.get('profile');
  if (name) {
    const r = loadProfile(name, dirs);
    if (!r.ok) return { ...out, preview: { error: r.error } };
    let project = null;
    const raw = q.get('project');
    if (raw !== null) {
      const f = checkProjectFolder(raw);
      if (f.error) return { ...out, preview: { name, scope: 'project', error: f.error } };
      project = f.root;
    }
    out.preview = { name, scope: project ? 'project' : 'global', project, rows: previewRows(r.profile, project, hosts) };
  }
  return out;
}

const CLI = () => path.join(ROOT, 'bin', 'geneseed-cli.mjs');

/**
 * The job for `POST /api/actions/profile-apply`, body `{ name, hosts: [..], project? }`:
 * `{ cmd }` or `{ error }` (400). `hosts` must be a non-empty subset of the profile's own (D41);
 * `project`, when given, passes the deploy form's folder check.
 */
export function profileApplyCmd(body, { src = {} } = {}) {
  const name = typeof body?.name === 'string' ? body.name : '';
  const r = loadProfile(name, profileDirs(src));
  if (!r.ok) return { error: r.error };
  const hosts = body?.hosts;
  if (!Array.isArray(hosts) || !hosts.length || !hosts.every((h) => typeof h === 'string')) {
    return { error: 'hosts must be a non-empty list of host ids' };
  }
  const bad = hosts.filter((h) => !r.profile.hosts.includes(h));
  if (bad.length) return { error: `not in profile '${name}': ${bad.join(', ')} (it lists ${r.profile.hosts.join(', ')})` };
  const argv = ['profile', 'apply', name, '--hosts', [...new Set(hosts)].join(',')];
  if (body.project !== undefined && body.project !== null) {
    const f = checkProjectFolder(body.project);
    if (f.error) return { error: f.error };
    argv.push('--project', f.root);
  }
  return { cmd: [process.execPath, CLI(), ...argv] };
}

/**
 * The job for `POST /api/actions/profile-save`, body `{ name, from: { host, path }, shipped?,
 * force? }`: `{ cmd }` or `{ error }` (400). `from` must be an ACTIVE detected install, matched on
 * its raw path as `/api/profiles` gave it, so the argv is built from the registry, never from body
 * strings. The refusals the CLI would print are answered here first: a Shipped destination outside
 * a git clone (D35), a name the other source holds (D36), an existing file without `force`.
 */
export function profileSaveCmd(body, { src = {}, root = ROOT } = {}) {
  const name = typeof body?.name === 'string' ? body.name : '';
  if (!NAME_RE.test(name)) return { error: `'${name}' is not a profile name: letters, digits, '.', '_' and '-' only` };
  const from = body?.from;
  const want = JSON.stringify([String(from?.host ?? ''), String(from?.path ?? '')]);
  const hit = activeTargets().findLast(([h, , r]) => JSON.stringify([h, String(r)]) === want);
  if (!hit) return { error: 'from must name an active install ({host, path})' };
  const [host, scope, installRoot] = hit;
  const shipped = body.shipped === true;
  if (shipped && !isGitClone(root)) return { error: 'a shipped profile can only be saved from a git clone of Geneseed' };
  const entries = listProfiles(profileDirs(src));
  const other = entries.find((e) => e.name === name && e.source === (shipped ? 'personal' : 'shipped'));
  if (other) return { error: `'${name}' is already a ${other.source} profile — a personal profile may not reuse a shipped name` };
  const same = entries.find((e) => e.name === name && e.source === (shipped ? 'shipped' : 'personal'));
  if (same && body.force !== true) return { error: `'${name}' already exists (${same.file}) — pick another name, or replace it` };
  const argv = ['profile', 'save', name, '--from', scope === 'global' ? `${host}-global` : host];
  if (scope !== 'global') argv.push('--project', String(installRoot));
  if (shipped) argv.push('--shipped');
  if (body.force === true) argv.push('--force');
  return { cmd: [process.execPath, CLI(), ...argv] };
}
