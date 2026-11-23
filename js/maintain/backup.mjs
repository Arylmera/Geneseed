/**
 * `geneseed backup` and `geneseed restore` — carry a user's personal Geneseed state to another
 * machine in one plain `.zip` (spec: docs/specs/2026-11-23-backup-restore.md, local).
 *
 * WHY: a new machine gets every shipped skill and agent back from one `setup`, and loses what
 * the user taught it — rules, profile, memory, notes, notebook, personal profiles, bricks, and
 * the skills they wrote themselves. A colleague changing machine at work raised it.
 *
 * WHAT TRAVELS IS READ FROM ITS OWNERS, NEVER TYPED HERE (One Writer Per Value): the tier names
 * come from `sharedPaths()`, `personalProfilesDir()`, `USER_LOOP_DIRS` and `RETIRED_RULES_FILE`.
 * Anything else at the tier's top level is machine state or another tool's file, and is named
 * under `skipped`. A skill or agent no install manifest owns was written by the user; a link is
 * listed with its target, never copied, because what it points at belongs elsewhere.
 *
 * A PROJECT IS FOUND BY SCANNING THE FOLDERS THE USER NAMES (`--projects`, remembered in the tier's
 * `backup.json`): the install registry knows only per-repo emits, and most projects hold a notebook
 * the global harness wrote with no install there at all. Only what git does not track travels.
 *
 * NO SECRET SCAN, NO ENCRYPTION: the user decided (2026-11-23) a backup is a plain copy of their
 * own files for their own use, as copying the folder by hand would be.
 *
 * Under the CLI's spawn ban like the rest of `js/maintain/`: it reads files, writes through
 * `js/lib/fs.mjs`, and starts nothing.
 */
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { foldHost, foldSummary, isWholeFileSeed } from '../build/fold.mjs';
import { installProfile } from '../build/profile.mjs';
import { RETIRED_RULES_FILE } from '../build/rule-decide.mjs';
import { knownSkillIds, ROOT, skillAliases } from '../build/source.mjs';
import { SESSION_SEEDS } from '../build/stubs.mjs';
import { DONE_GATE_DIR, EXCLUDES_FILE, GATE_LEDGER, GLOBAL_MANIFEST, HOSTS, isHostGlobalDir, resolvePath } from '../hosts/hosts.mjs';
import { consolidateMemory, indexNotes, readFoldState } from '../hosts/memory-files.mjs';
import { hashesOf, ownedState } from '../hosts/owned.mjs';
import { EMIT_HOST_SCOPE, installState, installTargets } from '../hosts/installs.mjs';
import { gitRootOf, trackedFiles } from '../hosts/gitref.mjs';
import { STATE_DIR } from '../hosts/store-watch.mjs';
import { RUNS_LEDGER, USAGE_LEDGER } from '../hosts/usage.mjs';
import { printErr, printOut, writeBytes, writeTextAtomic } from '../lib/fs.mjs';
import { jsonDumpsIndent } from '../lib/json.mjs';
import { machineDir, NOTES_DIRS, sharedPaths, WIKI_NAMES } from '../lib/machine-dir.mjs';
import { readZip, writeZip } from '../lib/zip.mjs';
import { USER_LOOP_DIRS } from '../loop/catalog.mjs';
import { personalProfilesDir, PROFILE_KEYS, profileFromInstall, saveProfile } from './profiles.mjs';
import { cmdProfileApply } from './setup.mjs';

export const BACKUP_FORMAT = 1;

/**
 * Every top-level tier name a backup carries, with the module that owns it. `root` is the tier
 * itself and `defaultInstall` names an install path on this machine: neither travels.
 * @type {{ name: string, from: string }[]}
 */
export const TIER_IN = (() => {
  const sp = sharedPaths();
  const rel = (p) => path.relative(sp.root, p);
  return [
    ...Object.entries(sp).filter(([k]) => k !== 'root' && k !== 'defaultInstall')
      .map(([, p]) => ({ name: rel(p), from: 'sharedPaths' })),
    { name: rel(personalProfilesDir()), from: 'profiles' },
    ...USER_LOOP_DIRS.map((name) => ({ name, from: 'loop' })),
    { name: RETIRED_RULES_FILE, from: 'rule-decide' },
  ];
})();

/** What an install's hooks append for themselves: this machine's records, never the user's notes. */
const MACHINE_RECORDS = [GATE_LEDGER, USAGE_LEDGER, RUNS_LEDGER, DONE_GATE_DIR, STATE_DIR]
  .map((p) => p.split(path.sep).join('/'));

/** A host's own whole files that travel. Its `excludes.json` does not: it records this machine's wiring. */
const HOST_FILES = ['user-rules.md', 'user-rules.draft.md', 'PROFILE.md', ...WIKI_NAMES, 'context.json', 'agent-overrides.json'];

/**
 * A host's own folders that travel: its memory and notebook, its agents' memory, the rules and
 * workflows the user added, and the back-port reports `diff` and `upgrade` save.
 */
const HOST_DIRS = ['memory', 'notebook', 'agent-memory', 'rules', 'workflows', 'improvements'];
/** Of those, the ones a host runs or obeys file by file: a second copy there would be in force. */
const LIVE_DIRS = ['rules', 'workflows'];

const lf = (b) => b.toString('utf8').replaceAll('\r\n', '\n');
const isRulesSeed = (b) => lf(b) === SESSION_SEEDS['user-rules.md'].replaceAll('\r\n', '\n');

/**
 * Is this host file still what an emit seeds? Then it says nothing of the user's: it does not
 * travel, and a restore may replace it. The two JSON files are judged by what they hold, because
 * their comment text changes between versions. One that does not parse is the user's.
 */
function isHostSeed(rel, bytes) {
  const name = rel.split('/').pop();
  if (rel === 'user-rules.md') return isRulesSeed(bytes);
  if (rel === 'PROFILE.md' || WIKI_NAMES.includes(rel)) return isWholeFileSeed(bytes);
  if (rel === 'memory/MEMORY.md' || rel === 'notebook/NOTEBOOK.md') return lf(bytes).trim() === SESSION_SEEDS[name].replaceAll('\r\n', '\n').trim();
  if (rel === 'context.json' || rel === 'agent-overrides.json') {
    try {
      const doc = JSON.parse(lf(bytes));
      const empty = (v) => v === undefined || v === null || Object.keys(v).length === 0;
      return rel === 'context.json' ? empty(doc.context) : empty(doc.agents) && empty(doc.tiers);
    } catch { return false; }
  }
  return false;
}

/** The machine record `rel` is, or is inside; undefined when it is neither. */
const recordOf = (rel) => MACHINE_RECORDS.find((r) => rel === r || rel.startsWith(`${r}/`));
/** Written by every emit: the ignore file, the store's README and the watch's own record. */
const isPlumbing = (rel) => /^(memory|notebook)\/\.gitignore$/.test(rel) || rel === 'memory/README.md' || rel === 'memory/.own-writes.json';

const toPosix = (p) => p.split(path.sep).join('/');

/**
 * Every regular file under `dir`, as `/`-separated paths relative to it, sorted. Links are skipped, and
 * so are the top-level folders named in `skip`.
 */
function filesUnder(dir, skip = []) {
  const out = [];
  const walk = (d, pre) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(d, e.name);
      if (e.isSymbolicLink() || (!pre && skip.includes(e.name))) continue;
      if (e.isDirectory()) walk(full, `${pre}${e.name}/`);
      else if (e.isFile()) out.push(`${pre}${e.name}`);
    }
  };
  walk(dir, '');
  return out;
}

const lstatMaybe = (p) => { try { return lstatSync(p); } catch { return null; } };

/** The install manifest's owned rels and recorded hashes; empty when there is none. */
function readOwned(root) {
  try {
    const doc = JSON.parse(readFileSync(path.join(root, GLOBAL_MANIFEST), 'utf8'));
    return { owned: Array.isArray(doc.owned) ? doc.owned.map(String) : [], hashes: hashesOf(doc) };
  } catch { return { owned: [], hashes: {} }; }
}

/** The tier's files that travel, and the top-level names that do not. */
function collectTier(tier) {
  const allowed = new Set(TIER_IN.map((e) => e.name));
  const files = []; const skipped = [];
  for (const name of (lstatMaybe(tier) ? readdirSync(tier) : []).sort()) {
    const full = path.join(tier, name);
    const st = lstatMaybe(full);
    if (!allowed.has(name) || !st || st.isSymbolicLink()) { skipped.push(name); continue; }
    if (st.isDirectory()) for (const rel of filesUnder(full)) files.push({ name: `tier/${name}/${rel}`, file: path.join(full, rel) });
    else if (st.isFile()) files.push({ name: `tier/${name}`, file: full });
  }
  return { files, skipped };
}

/**
 * What is the user's own in one global install, the same for every host: skills, agents, the host's
 * own rules, profile, wiki, context and agent overrides once filled in, its memory and its
 * notebook. What stays behind is named in `left`.
 *
 * A SKILL IS A FOLDER WITH A `SKILL.md` AT ITS ROOT AND NO LEADING DOT. A host keeps other things in
 * `skills/`: Claude Code's `synced/` cache and a `.trash/` were 90 % of one real backup.
 */
function collectHost(host, root) {
  const { owned, hashes } = readOwned(root);
  // A file Geneseed wrote that the user then edited: a fresh install would write over it.
  const edited = (rel) => ownedState(root, rel, hashes) === 'modified';
  const shipped = new Set([...knownSkillIds(), ...skillAliases().keys()]);
  const files = []; const links = []; const ambiguous = []; const left = [];
  const skillsDir = path.join(root, 'skills');
  for (const name of (lstatMaybe(skillsDir) ? readdirSync(skillsDir) : []).sort()) {
    const full = path.join(skillsDir, name);
    const st = lstatMaybe(full);
    if (!st) continue;
    if (st.isSymbolicLink()) {
      let target = null;
      try { target = realpathSync.native(full); } catch { /* a dead link: no target */ }
      links.push({ host, kind: 'skill', name, target });
      continue;
    }
    if (!st.isDirectory()) {
      if (!owned.includes(`skills/${name}`)) left.push(`${host} skills/${name}`);
      continue;
    }
    const inside = filesUnder(full);
    if (name.startsWith('.') || !inside.includes('SKILL.md')) { left.push(`${host} skills/${name}`); continue; }
    if (owned.some((r) => r.startsWith(`skills/${name}/`))) {
      // An owned folder travels only when the user edited a file in it or added one.
      const rels = inside.map((rel) => `skills/${name}/${rel}`);
      if (!rels.some((r) => edited(r) || !owned.includes(r))) continue;
      ambiguous.push(`skills/${host}/${name}`);
    } else if (shipped.has(name)) {
      ambiguous.push(`skills/${host}/${name}`);
    }
    for (const rel of inside) files.push({ name: `skills/${host}/${name}/${rel}`, file: path.join(full, rel) });
  }
  const agentsDir = path.join(root, 'agents');
  for (const f of (lstatMaybe(agentsDir) ? readdirSync(agentsDir) : []).sort()) {
    if (!f.endsWith('.md')) continue;
    const full = path.join(agentsDir, f);
    const st = lstatMaybe(full);
    if (st?.isSymbolicLink()) {
      let target = null;
      try { target = realpathSync.native(full); } catch { /* dead link */ }
      links.push({ host, kind: 'agent', name: f.slice(0, -3), target });
    }
  }
  // Nested too: a host reads `agents/<team>/<name>.md`.
  for (const f of lstatMaybe(agentsDir) ? filesUnder(agentsDir) : []) {
    const rel = `agents/${f}`;
    if (!f.endsWith('.md')) { if (!owned.includes(rel)) left.push(`${host} ${rel}`); continue; }
    if (owned.includes(rel) && !edited(rel)) continue;
    if (owned.includes(rel)) ambiguous.push(`agents/${host}/${f}`);
    files.push({ name: `agents/${host}/${f}`, file: path.join(agentsDir, f) });
  }
  const own = (rel) => {
    const full = path.join(root, ...rel.split('/'));
    if (owned.includes(rel) && !edited(rel)) return;
    if (!isHostSeed(rel, readFileSync(full))) files.push({ name: `host/${host}/${rel}`, file: full });
  };
  for (const rel of HOST_FILES) if (lstatMaybe(path.join(root, rel))?.isFile()) own(rel);
  for (const dir of HOST_DIRS) {
    const base = path.join(root, dir);
    if (!lstatMaybe(base)?.isDirectory()) continue;
    for (const f of filesUnder(base)) {
      const rel = `${dir}/${f}`;
      const record = recordOf(rel);
      if (record) { if (!left.includes(`${host} ${record}`)) left.push(`${host} ${record}`); continue; }
      if (isPlumbing(rel)) continue;
      own(rel);
    }
  }
  return { files, links, ambiguous, left };
}

// --- projects ------------------------------------------------------------------------------

/** How deep under a named folder a project is looked for. */
const PROJECT_DEPTH = 6;
const PROJECT_FILES = ['user-rules.md', 'PROFILE.md'];
const PROJECT_LAYERS = HOSTS.map((h) => h.projectMarker);
/**
 * The only paths a project entry may have, in the archive and on restore: the manifest names the
 * project's folder, so this is what keeps a forged archive out of its code.
 */
const PROJECT_REL = new RegExp(`^(?:(?:${PROJECT_LAYERS.map((m) => m.replace('.', '\\.')).join('|')})/)?(?:(?:memory|notebook)/.+|${PROJECT_FILES.map((f) => f.replace('.', '\\.')).join('|')})$`
  + `|^(?:${PROJECT_LAYERS.map((m) => m.replace('.', '\\.')).join('|')})/agent-memory/.+$`);

/** What only Geneseed puts in a notebook: the index, the lessons, the hooks' records. */
const NOTEBOOK_MARKS = ['NOTEBOOK.md', ...NOTES_DIRS, ...MACHINE_RECORDS.map((r) => r.replace('notebook/', ''))];

/** Windows reads two spellings as one file; git's index holds one of them. */
const foldCase = (s) => (process.platform === 'win32' ? s.toLowerCase() : s);

/** The project installs at `dir`, which holds `names`: its own emit marker, then each host's layer. */
function projectInstalls(dir, names) {
  const out = [];
  const add = (host) => { if (!out.some((p) => p.host === host)) out.push({ host, root: dir }); };
  const emit = names.has('.geneseed-emit') ? readMaybe(path.join(dir, '.geneseed-emit'))?.toString('utf8').trim() : undefined;
  if (emit !== undefined) {
    const [host, scope] = EMIT_HOST_SCOPE.get(emit) ?? [emit, 'project'];
    if (scope === 'project') add(host);
  }
  for (const { host, projectMarker } of HOSTS) {
    if (!names.has(projectMarker)) continue;
    const layer = path.join(dir, projectMarker);
    if (lstatMaybe(path.join(layer, GLOBAL_MANIFEST))?.isFile() && !isHostGlobalDir(host, layer)) add(host);
  }
  return out;
}

/**
 * What Geneseed keeps in the project at `dir` that git does not carry, as `{ rels, left }`.
 *
 * WHOSE FOLDER IS IT? `notebook/` and `memory/` are names other tools use too. They are Geneseed's
 * in an install, in a project that holds `.geneseed/`, or where the folder holds something only
 * Geneseed writes (`NOTEBOOK_MARKS`; a memory's `MEMORY.md`). `PROFILE.md` is taken from an install
 * only. Names are matched as they are spelled on disk, so a vault's `Memory/` is not `memory/` on
 * Windows either. A notebook's `archive/` stays behind: it was 130 MB of one real notebook, and says it is done with.
 */
function projectFiles(dir, top, installs, trackedOf) {
  const rels = []; const left = [];
  const take = (rel, seedRel) => {
    const repo = gitRootOf(dir);
    const inRepo = repo ? toPosix(path.relative(repo, dir)) : '';
    if (repo && trackedOf(repo).has(foldCase(inRepo ? `${inRepo}/${rel}` : rel))) return;
    const full = path.join(dir, ...rel.split('/'));
    if (!isHostSeed(seedRel, readFileSync(full))) rels.push(rel);
  };
  for (const layer of ['', ...PROJECT_LAYERS]) {
    if (layer && !top.has(layer)) continue;
    const base = path.join(dir, layer);
    const pre = layer ? `${layer}/` : '';
    if (layer && (!lstatMaybe(base)?.isDirectory() || isHostGlobalDir(null, base))) continue;
    const names = layer ? new Set(readdirSync(base)) : top;
    const stores = ['memory', 'notebook', ...(layer ? ['agent-memory'] : [])].filter((s) => names.has(s));
    if (!stores.length && !PROJECT_FILES.some((f) => names.has(f))) continue;
    const { owned, hashes } = readOwned(base);
    const isInstall = layer ? lstatMaybe(path.join(base, GLOBAL_MANIFEST))?.isFile() : installs.length > 0;
    const shipped = (rel) => owned.includes(rel) && ownedState(base, rel, hashes) !== 'modified';
    const ours = isInstall || (!layer && lstatMaybe(path.join(dir, '.geneseed'))?.isDirectory());
    for (const f of PROJECT_FILES) {
      if (!names.has(f) || (f === 'PROFILE.md' && !isInstall)) continue;
      if (lstatMaybe(path.join(base, f))?.isFile() && !shipped(f)) take(`${pre}${f}`, f);
    }
    for (const store of stores) {
      const folder = path.join(base, store);
      if (!lstatMaybe(folder)?.isDirectory()) continue;
      const marks = store === 'notebook' ? NOTEBOOK_MARKS : ['MEMORY.md'];
      if (store !== 'agent-memory' && !ours && !marks.some((m) => lstatMaybe(path.join(folder, m)))) continue;
      const archived = store === 'notebook' && lstatMaybe(path.join(folder, 'archive'))?.isDirectory();
      if (archived) left.push(`${pre}notebook/archive`);
      for (const f of filesUnder(folder, archived ? ['archive'] : [])) {
        const rel = `${store}/${f}`;
        const record = recordOf(rel);
        if (record) { if (!left.includes(pre + record)) left.push(pre + record); continue; }
        if (!isPlumbing(rel) && !shipped(rel)) take(pre + rel, rel);
      }
    }
  }
  return { rels, left };
}

/**
 * Every project under `roots`: its stores and its installs. A link is never followed, and neither
 * `node_modules`, a dot folder nor a store is walked into.
 */
function collectProjects(roots) {
  const files = []; const stores = []; const installs = []; const left = []; const unread = [];
  const seen = new Set(); const ids = new Set();
  const indexes = new Map();
  const trackedOf = (repo) => {
    if (!indexes.has(repo)) indexes.set(repo, new Set([...trackedFiles(repo) ?? []].map(foldCase)));
    return indexes.get(repo);
  };
  const visit = (dir, depth) => {
    const key = resolvePath(dir);
    if (seen.has(key)) return;
    seen.add(key);
    try {
      const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
      const names = new Set(entries.map((e) => e.name));
      const here = projectInstalls(dir, names);
      installs.push(...here);
      const own = projectFiles(dir, names, here, trackedOf);
      left.push(...own.left.map((l) => `${dir} ${l}`));
      if (own.rels.length) {
        // Compared without case: `api` and `Api` are one folder where the archive may land.
        const name = path.basename(dir).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^\.+|\.+$/g, '') || 'project';
        let id = name;
        for (let n = 2; ids.has(id.toLowerCase()); n += 1) id = `${name}-${n}`;
        ids.add(id.toLowerCase());
        stores.push({ id, root: dir });
        for (const rel of own.rels) files.push({ name: `projects/${id}/${rel}`, file: path.join(dir, ...rel.split('/')) });
      }
      if (depth >= PROJECT_DEPTH) return;
      for (const e of entries) {
        if (!e.isDirectory() || e.isSymbolicLink() || e.name.startsWith('.')) continue;
        if (['node_modules', 'notebook', 'memory'].includes(e.name)) continue;
        visit(path.join(dir, e.name), depth + 1);
      }
    } catch (e) { unread.push(`${dir}: ${e && e.message}`); }
  };
  for (const r of roots) visit(r, 0);
  return { files, stores, installs, left, unread };
}

const settingsFile = () => path.join(machineDir(), 'backup.json');

/** The project folders the last backup was told to scan; [] when none, or the file is not readable. */
export function projectRoots() {
  try {
    const { projects } = JSON.parse(readFileSync(settingsFile(), 'utf8'));
    return Array.isArray(projects) ? projects.filter((p) => typeof p === 'string') : [];
  } catch { return []; }
}

/**
 * `--projects` read: absolute folders, from a list in the platform's PATH style, or `none`.
 * @param {string} value
 * @returns {{ roots: string[] } | { error: string }}
 */
export function parseProjects(value) {
  if (value.trim() === 'none') return { roots: [] };
  const roots = value.split(path.delimiter).map((s) => s.trim()).filter(Boolean).map((s) => path.resolve(s));
  if (!roots.length) return { error: 'name a folder to scan, or none' };
  const bad = roots.find((r) => !lstatMaybe(r)?.isDirectory());
  return bad ? { error: `${bad} is not a folder on this machine` } : { roots };
}

function geneseedVersion() {
  try { return JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return 'unknown'; }
}

/** Every live install on this machine, as `[host, scope, root]`. */
function activeTargets() {
  return installTargets().filter(([host, scope, root]) => installState(root, host, scope) === 'active');
}

/**
 * What a backup holds: its entries (without `manifest.json`) and the manifest describing them.
 * `targets` and `profileOf` are the seams a test hands its sandboxed installs through.
 *
 * ONE GLOBAL INSTALL PER HOST: restore writes one config dir per host, and a second root's
 * `skills/<host>/<name>` would collide with the first in the archive. The first root travels;
 * a later one, and an install whose settings cannot be read, are named under `unread` while the
 * rest of the backup goes on.
 * @param {{ now?: Date, targets?: [string, string, string][] | null, projects?: string[],
 *   profileOf?: (host: string, root: string) => object }} [opts]
 */
export function collectBackup({
  now = new Date(), targets = null, projects: roots = projectRoots(),
  profileOf = (host, root) => profileFromInstall(installProfile(host, 'global', root)),
} = {}) {
  const tier = machineDir();
  const { files: tierFiles, skipped } = collectTier(tier);
  const files = [...tierFiles]; const links = []; const ambiguous = [];
  const installs = []; const projects = []; const unread = []; const hostSkipped = [];
  const seen = new Set();
  for (const [host, scope, root] of targets ?? activeTargets()) {
    if (scope !== 'global') { projects.push({ host, root }); continue; }
    if (seen.has(host)) { unread.push(`${host} ${root}: a second global install of this host`); continue; }
    seen.add(host);
    const h = collectHost(host, root);
    files.push(...h.files); links.push(...h.links); ambiguous.push(...h.ambiguous); hostSkipped.push(...h.left);
    try { installs.push({ host, profile: profileOf(host, root) }); } catch (e) {
      unread.push(`${host} ${root}: ${e && e.message}`);
    }
  }
  const scan = collectProjects(roots);
  files.push(...scan.files); hostSkipped.push(...scan.left); unread.push(...scan.unread);
  for (const p of scan.installs) {
    if (!projects.some((q) => q.host === p.host && resolvePath(q.root) === resolvePath(p.root))) projects.push(p);
  }
  const entries = files.map(({ name, file }) => ({ name: toPosix(name), data: readFileSync(file) }));
  const manifest = {
    format: BACKUP_FORMAT,
    geneseed: geneseedVersion(),
    createdAt: now.toISOString(),
    os: process.platform,
    home: os.homedir(),
    tier,
    files: entries.map((e) => ({ name: e.name, sha256: createHash('sha256').update(e.data).digest('hex'), size: e.data.length })),
    installs, projects, stores: scan.stores, links, skipped, hostSkipped, ambiguous, unread,
  };
  return { entries, manifest };
}

/** `geneseed-backup-<machine>-<YYYYMMDD-HHMM>.zip`: two machines' backups never share a name. */
export function defaultBackupName(now) {
  const host = os.hostname().replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'machine';
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `geneseed-backup-${host}-${stamp}.zip`;
}

/** The lines every backup prints after its total: what stayed behind, and why. */
function backupNotes(manifest) {
  const out = [];
  if (manifest.skipped.length) out.push(`[backup] not carried (machine state or another tool's): ${manifest.skipped.join(', ')}`);
  if (manifest.hostSkipped.length) out.push(`[backup] not carried (a cache, a machine record or not a skill): ${manifest.hostSkipped.join(', ')}`);
  for (const l of manifest.links) out.push(`[backup] link not copied: ${l.host} ${l.kind} ${l.name} -> ${l.target ?? '(dead link)'}`);
  for (const p of manifest.projects) out.push(`[backup] project install not replayed: ${p.host} ${p.root}`);
  for (const a of manifest.ambiguous) out.push(`[backup] carried, edited or named like a shipped one: ${a}`);
  for (const u of manifest.unread) out.push(`[backup] not carried, unreadable or a second install: ${u}`);
  for (const s of manifest.stores) out.push(`[backup] project carried: ${s.root}`);
  return out;
}

/**
 * `geneseed backup [--out <file>] [--projects <folders>] [--dry-run]`. 0 written (or previewed), 1
 * refused. A written backup remembers the folders it was given; a dry run writes nothing.
 * @param {{ out?: string, projects?: string | null, dryRun?: boolean }} args
 */
export function cmdBackup(args = {}) {
  const now = new Date();
  const given = args.projects == null ? null : parseProjects(String(args.projects));
  if (given && 'error' in given) {
    printErr(`[backup] refused: ${given.error}; nothing written\n`);
    return 1;
  }
  const roots = given && 'roots' in given ? given.roots : projectRoots();
  let backup;
  try { backup = collectBackup({ now, projects: roots }); } catch (e) {
    printErr(`[backup] could not read what to back up: ${e && e.message}\n`);
    return 1;
  }
  const { entries, manifest } = backup;
  const total = entries.reduce((n, e) => n + e.data.length, 0);
  const notes = backupNotes(manifest);
  if (args.dryRun) {
    for (const e of entries) printOut(`${String(e.data.length).padStart(10)}  ${e.name}\n`);
    printOut(`[backup] dry run: ${entries.length} files, ${total} bytes — nothing written\n`);
    for (const l of notes) printOut(`${l}\n`);
    return 0;
  }
  const out = path.resolve(args.out ? String(args.out) : defaultBackupName(now));
  let zip;
  try {
    zip = writeZip([{ name: 'manifest.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8') }, ...entries]);
  } catch (e) {
    printErr(`[backup] refused: ${e && e.message}\n`);
    return 1;
  }
  try { writeBytes(out, zip, { exclusive: true }); } catch (e) {
    printErr(e && e.code === 'EEXIST'
      ? `[backup] ${out} exists — choose another --out; nothing written\n`
      : `[backup] could not write ${out}: ${e && e.message}\n`);
    return 1;
  }
  if (given) {
    try {
      mkdirSync(machineDir(), { recursive: true });
      writeTextAtomic(settingsFile(), `${JSON.stringify({ projects: roots }, null, 2)}\n`);
    } catch (e) { printErr(`[backup] could not remember the project folders: ${e && e.message}\n`); }
  }
  printOut(`[backup] wrote ${out}: ${entries.length} files, ${total} bytes\n`);
  for (const l of notes) printOut(`${l}\n`);
  printOut('[backup] the archive is a plain copy of your own files: keep it somewhere only you can read\n');
  return 0;
}

// --- restore -------------------------------------------------------------------------------

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `text` with every JSON(C) string literal passed through `onLiteral(raw)`, where `raw` is the
 * literal's text between its quotes, escapes kept. Comments and everything else are copied as
 * they are. One walker for the home rewrite and the wiki path report, so a `//` inside a string
 * (an `https://` value) is never read as a comment.
 */
function mapJsoncStrings(text, onLiteral) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('//', i)) {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      out += text.slice(i, stop); i = stop;
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop); i = stop;
    } else if (text[i] === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += `"${onLiteral(text.slice(i + 1, j))}"`; i = j + 1;
    } else {
      out += text[i]; i += 1;
    }
  }
  return out;
}

const isDriveHome = (p) => /^[A-Za-z]:/.test(p);

/**
 * `text` with the home `fromHome` replaced by `toHome` inside JSON(C) string literals only.
 * Comments are copied as they are. A prefix matches only at a path boundary, so `/home/old`
 * leaves `/home/older` alone; a drive-letter home matches without regard to case, as Windows does.
 *
 * SAME OS: each literal keeps the spelling it was written in — `/`, `\`, or the JSON-escaped `\\`.
 * ACROSS OSes (a drive-letter home on one side only): a literal that held the old home takes the
 * target's separator throughout, `/` on POSIX and an escaped `\\` on Windows — a Windows path
 * moved to a Mac as `\home\new\Terra` names no folder at all.
 * @param {string} text
 * @param {string} fromHome
 * @param {string} toHome
 */
export function rewriteHome(text, fromHome, toHome) {
  if (!fromHome || !toHome || fromHome === toHome) return text;
  const fwd = (p) => p.replaceAll('\\', '/');
  const back = (p) => p.replaceAll('/', '\\');
  const esc = (p) => back(p).replaceAll('\\', '\\\\');
  const flags = isDriveHome(fromHome) ? 'gi' : 'g';
  const pairs = [[esc(fromHome), esc(toHome)], [back(fromHome), back(toHome)], [fwd(fromHome), fwd(toHome)]]
    .map(([a, b]) => [new RegExp(`${escapeRe(a)}(?=$|[\\\\/])`, flags), b]);
  const crossOs = isDriveHome(fromHome) !== isDriveHome(toHome);
  return mapJsoncStrings(text, (lit) => {
    const swapped = pairs.reduce((s, [re, b]) => s.replace(re, () => b), lit);
    if (!crossOs || swapped === lit) return swapped;
    return isDriveHome(toHome)
      ? swapped.replaceAll('\\\\', '/').replaceAll('\\', '/').replaceAll('/', '\\\\')
      : swapped.replaceAll('\\\\', '/').replaceAll('\\', '/');
  });
}

/**
 * The archive at `file`, checked: its manifest first, a format this build reads, and every file
 * the manifest lists present with its sha256. Throws, naming the entry, before anything is written.
 * @param {string} file
 */
export function readBackup(file) {
  const all = readZip(readFileSync(file));
  if (!all.length || all[0].name !== 'manifest.json') throw new Error('not a Geneseed backup: manifest.json is not its first entry');
  const manifest = JSON.parse(all[0].data.toString('utf8'));
  if (manifest.format !== BACKUP_FORMAT) throw new Error(`backup format ${manifest.format} is not one this Geneseed reads (${BACKUP_FORMAT})`);
  const entries = new Map(all.slice(1).map((e) => [e.name, e.data]));
  for (const f of manifest.files) {
    const data = entries.get(f.name);
    if (!data) throw new Error(`file listed but missing: ${f.name}`);
    if (sha256(data) !== f.sha256) throw new Error(`sha256 mismatch: ${f.name}`);
  }
  if (entries.size !== manifest.files.length) throw new Error('the archive holds a file its manifest does not list');
  return { manifest, entries };
}

const RESTORED = 'restored';

function readMaybe(p) {
  try { return readFileSync(p); } catch { return null; }
}

/**
 * The first of `name`, `<stem>-restored`, `<stem>-restored-2`, … in `dir` that is free or already
 * holds `data` — the chain the fold walks for a host called `restored`, so a repeat finds its
 * own earlier copy and a second restore writes nothing.
 */
function restoredLanding(dir, name, data) {
  const { name: stem, ext } = path.parse(name);
  for (let n = 1; ; n += 1) {
    const dest = path.join(dir, n === 1 ? name : `${stem}-${RESTORED}${n === 2 ? '' : `-${n - 1}`}${ext}`);
    const held = readMaybe(dest);
    if (held === null) return { dest, write: true };
    if (held.equals(data)) return { dest, write: false };
  }
}

const sectionsOf = (text) => text.replaceAll('\r\n', '\n').split(/^(?=## )/m).filter((s) => s.trim());
const lineSet = (b) => new Set(lf(b).split('\n').filter((l) => l.trim()));
/** The `sha256: <key>` a draft block carries — the key its ledger row is filed under. */
const draftKey = (block) => /sha256: ([0-9a-f]+)/.exec(block)?.[1] ?? null;

/**
 * Put the archive's `tier/` files into this machine's tier, never overwriting.
 *
 * A FILE THE TIER LACKS IS COPIED AS IT IS, whatever it is: a fact with an all-caps stem, a note
 * that is not markdown. Only a real collision is decided, and each decision keeps both texts
 * readable on this machine:
 *   - a rules file in use: staged and folded in as host `restored` (`foldHost`), so each rule it
 *     lacks waits in the draft, in force nowhere until the user decides;
 *   - an agent lesson file: folded the same way, so the lessons merge line by line;
 *   - `excludes.json`: folded, so the paths the shared list lacks join it (wiring them into repos
 *     is the next emit's, against the real installs);
 *   - the draft: each block of the backup's whose `sha256:` key the live draft lacks is appended;
 *   - `.fold-state.json`: this machine's decision on a key stands; from the backup come the decided
 *     rows and the pending rows whose block the live draft now holds — any other pending row would
 *     be an item nothing can show;
 *   - the retired-rules record gains its missing sections;
 *   - anything else, the profile and the wiki manifest included, lands beside the original as
 *     `<stem>-restored<ext>`, then `-restored-2`: a draft pointer would name a staging file that is
 *     gone once the restore ends.
 * A seed is not the user's: the rules, profile and wiki seeds are replaced. `memory/MEMORY.md` and
 * `topics/` are rebuilt from the facts (`consolidateMemory`), not copied.
 * @param {{ manifest: any, entries: Map<string, Buffer> }} backup
 * @param {{ dryRun?: boolean }} [opts]
 */
export function restoreTier({ manifest, entries }, { dryRun = false } = {}) {
  const shared = sharedPaths();
  const tier = shared.root;
  const home = os.homedir();
  const profilesRel = path.relative(tier, personalProfilesDir()).split(path.sep).join('/');
  const draftRel = path.relative(tier, shared.draft).split(path.sep).join('/');
  const rewrites = (rel) => WIKI_NAMES.includes(rel) || rel === EXCLUDES_FILE
    || (rel.startsWith(`${profilesRel}/`) && rel.endsWith('.json'));
  const backupDraft = entries.get(`tier/${draftRel}`)?.toString('utf8') ?? '';
  const copied = []; const merged = []; const same = []; const failed = [];
  const staging = mkdtempSync(path.join(os.tmpdir(), 'gs-restore-'));
  let staged = 0;
  let factsWritten = false;
  const stage = (rel, data) => {
    const p = path.join(staging, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeBytes(p, data);
    staged += 1;
  };
  const write = (dest, data, exclusive) => {
    if (dryRun) return;
    mkdirSync(path.dirname(dest), { recursive: true });
    writeBytes(dest, data, { exclusive });
  };
  try {
    for (const [name, raw] of entries) {
      if (!name.startsWith('tier/')) continue;
      const rel = name.slice('tier/'.length);
      if (rel.startsWith('memory/topics/')) continue;
      if (rel === 'memory/MEMORY.md') {
        // The index is rebuilt from the facts; only the lines a person wrote into it travel.
        // `consolidateMemory` carries such lines, so they go into this machine's index first.
        const scratch = path.join(staging, 'index-of-backup');
        mkdirSync(scratch, { recursive: true });
        writeBytes(path.join(scratch, 'MEMORY.md'), raw);
        const notes = indexNotes(scratch, (slug) => entries.has(`tier/memory/${slug}.md`));
        const dest = path.join(shared.memory, 'MEMORY.md');
        const held = readMaybe(dest);
        if (held === null) {
          write(dest, raw, true);
          copied.push(rel);
          factsWritten = true;
          continue;
        }
        const have = lineSet(held);
        const missing = notes.filter((l) => !have.has(l));
        if (!missing.length) { same.push(rel); continue; }
        const text = held.toString('utf8');
        write(dest, Buffer.from(`${text}${text.endsWith('\n') || !text ? '' : '\n'}${missing.join('\n')}\n`, 'utf8'), false);
        merged.push(rel);
        continue;
      }
      const data = rewrites(rel) ? Buffer.from(rewriteHome(raw.toString('utf8'), manifest.home, home), 'utf8') : raw;
      const dest = path.join(tier, ...rel.split('/'));
      const held = readMaybe(dest);
      if (held !== null && held.equals(data)) { same.push(rel); continue; }
      const isFact = /^memory\/[^/]+\.md$/.test(rel);
      const isSeed = held !== null && (rel === 'user-rules.md' ? isRulesSeed(held)
        : (rel === 'PROFILE.md' || WIKI_NAMES.includes(rel)) && isWholeFileSeed(held));
      if (held === null || isSeed) {
        write(dest, data, held === null);
        copied.push(rel);
        if (isFact) factsWritten = true;
        continue;
      }
      if (rel === 'user-rules.md' || rel === EXCLUDES_FILE) { stage(rel, data); continue; }
      if (/^memory\/agents\/[^/]+\.md$/.test(rel)) {
        const have = lineSet(held);
        if ([...lineSet(data)].every((l) => have.has(l))) { same.push(rel); continue; }
        stage(rel, data);
        continue;
      }
      if (rel === draftRel) {
        const text = held.toString('utf8');
        const missing = sectionsOf(data.toString('utf8')).filter((s) => draftKey(s) && !text.includes(`sha256: ${draftKey(s)}`));
        if (!missing.length) { same.push(rel); continue; }
        write(dest, Buffer.from(`${text}${text.endsWith('\n') || !text ? '' : '\n'}\n${missing.join('')}`, 'utf8'), false);
        merged.push(rel);
        continue;
      }
      if (rel === path.basename(shared.foldState)) continue;   // below, once the draft is merged
      if (rel === RETIRED_RULES_FILE) {
        const have = new Set(sectionsOf(held.toString('utf8')).map((s) => s.trim()));
        const missing = sectionsOf(data.toString('utf8')).filter((s) => !have.has(s.trim()));
        if (!missing.length) { same.push(rel); continue; }
        const text = held.toString('utf8');
        write(dest, Buffer.from(`${text}${text.endsWith('\n') || !text ? '' : '\n'}${missing.join('')}`, 'utf8'), false);
        merged.push(rel);
        continue;
      }
      const landing = restoredLanding(path.dirname(dest), path.basename(dest), data);
      if (!landing.write) { same.push(rel); continue; }
      write(landing.dest, data, true);
      merged.push(path.relative(tier, landing.dest).split(path.sep).join('/'));
      if (isFact) factsWritten = true;
    }
    const theirs = entries.get(`tier/${path.basename(shared.foldState)}`);
    if (theirs) {
      const mine = readFoldState(shared);
      const items = JSON.parse(theirs.toString('utf8')).items ?? {};
      const add = Object.keys(items).filter((k) => !Object.hasOwn(mine.items, k)
        && (items[k]?.state !== 'pending' || backupDraft.includes(`sha256: ${k}`)));
      if (add.length) {
        for (const k of add) mine.items[k] = items[k];
        if (!dryRun) writeTextAtomic(shared.foldState, `${jsonDumpsIndent(mine)}\n`);
        merged.push(path.basename(shared.foldState));
      }
    }
    if (factsWritten && !dryRun) consolidateMemory(shared.memory);
    let folded = '';
    let notices = [];
    if (staged) {
      // One fold host per backup: the fold settles away a pending rule its host no longer holds,
      // so a shared `restored` host would drop one backup's rules on the next backup's restore.
      const host = `${RESTORED}-${sha256(`${manifest.createdAt}\n${manifest.home}`).slice(0, 8)}`;
      const report = foldHost({ host, cfgDir: staging, shared, dryRun });
      failed.push(...report.failed);
      failed.push(...report.stayed.map((s) => `not restored, the fold does not carry it: ${s}`));
      if (report.excludes) merged.push(EXCLUDES_FILE);
      folded = foldSummary({ ...report, excludes: 0, wired: 0, wiredPaths: [], archived: null, stayed: [] });
      notices = report.notices;
    }
    return { copied, merged, same, failed, folded, notices };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * The personal profile a recorded install is rebuilt from: `restored-<host>`, then
 * `restored-<host>-2`, … — the first that is free or already holds this profile, so a second
 * restore applies the same file and saves nothing. A dry run only names it.
 */
function restoredProfile(host, profile, dryRun) {
  const dir = personalProfilesDir();
  for (let n = 1; ; n += 1) {
    const name = `restored-${host}${n === 1 ? '' : `-${n}`}`;
    const held = readMaybe(path.join(dir, `${name}.json`));
    if (held === null) {
      if (!dryRun) {
        const r = saveProfile(name, profile, { dir });
        if (!r.ok) throw new Error(r.error);
      }
      return name;
    }
    // Compared as `saveProfile` wrote it: keys it does not know are dropped on both sides.
    const known = Object.fromEntries(PROFILE_KEYS.filter((k) => profile[k] !== undefined).map((k) => [k, profile[k]]));
    try { if (isDeepStrictEqual(JSON.parse(held.toString('utf8')), known)) return name; } catch { /* not ours: next name */ }
  }
}

/** Every absolute path a wiki manifest names that does not exist here. Comments are skipped. */
function missingWikiPaths(text) {
  const strings = [];
  mapJsoncStrings(text, (raw) => {
    try { strings.push(JSON.parse(`"${raw}"`)); } catch { /* not a JSON string */ }
    return raw;
  });
  return strings
    .filter((s) => /^([A-Za-z]:[\\/]|[\\/]|~[\\/])/.test(s))
    .map((s) => (s.startsWith('~') ? path.join(os.homedir(), s.slice(2)) : s))
    .filter((p) => !lstatMaybe(p));
}

/**
 * Where a project's files go: its folder, with the old home rewritten, when that is here; else
 * `aside`, a folder of its own under the home, because a half-made project would stand in the way
 * of the clone. A restore run again once the project is cloned puts them in place.
 */
function projectTarget({ id, root: was }, fromHome) {
  const root = JSON.parse(rewriteHome(JSON.stringify(String(was)), fromHome, os.homedir()));
  if (path.isAbsolute(root) && lstatMaybe(root)?.isDirectory()) return { root, aside: null };
  return { root, aside: path.join(os.homedir(), 'geneseed-restored-projects', id) };
}

/** Is `dest`, or any folder between `root` and it, a link? Then writing would leave `root`. */
function throughLink(root, dest) {
  const parts = path.relative(root, dest).split(path.sep);
  let p = root;
  for (const part of parts) {
    p = path.join(p, part);
    const st = lstatMaybe(p);
    if (!st) return false;
    if (st.isSymbolicLink()) return true;
  }
  return false;
}

/**
 * `geneseed restore <file> [--dry-run]`, on a machine where Geneseed is installed.
 * 0 all restored; 1 refused, nothing written; 2 partial — a host not rebuilt or a step that
 * failed, each named. Every step after the archive check is caught and reported: a stack trace
 * after half a restore would leave the user nothing to act on. `deps.apply` is the seam a test
 * stubs `profile apply` through.
 *
 * A SKILL, AGENT OR HOST FILE goes in where it is absent. Where it is present and is Geneseed's own text,
 * untouched (`ownedState` 'unmodified' — a `setup` just wrote it), the backup's edit replaces it.
 * A host file still at its seed is replaced the same way. Where the user's own text is there, it is kept and the backup's lands beside it as
 * `-restored`. Nothing is written through a link. A project's files follow the same rule, in its
 * folder or aside (`projectTarget`), and only under the names `PROJECT_REL` lists.
 * @param {{ file?: string, dryRun?: boolean }} args
 * @param {{ apply?: (name: string) => number }} [deps]
 */
export function cmdRestore(args = {}, deps = {}) {
  const { apply = (name) => cmdProfileApply({ name }, {}, {}) } = deps;
  if (!args.file) {
    printErr('[restore] name the backup to restore: geneseed restore <file.zip>\n');
    return 1;
  }
  let backup;
  try { backup = readBackup(path.resolve(String(args.file))); } catch (e) {
    printErr(`[restore] refused: ${e && e.message}; nothing written\n`);
    return 1;
  }
  const dryRun = Boolean(args.dryRun);
  const { manifest, entries } = backup;
  const say = (s) => printOut(`[restore] ${dryRun ? '(dry run) ' : ''}${s}\n`);
  let partial = false;

  try {
    const t = restoreTier(backup, { dryRun });
    say(`tier: ${t.copied.length} copied, ${t.merged.length} merged beside yours, ${t.same.length} already here`);
    for (const m of t.merged) say(`merged: ${m}`);
    if (t.folded) say(`folded: ${t.folded}`);
    for (const n of t.notices) say(n);
    for (const f of t.failed) { partial = true; say(`tier step failed: ${f}`); }
  } catch (e) {
    partial = true;
    say(`tier step failed: ${e && e.message}`);
  }

  let written = 0;
  const owned = new Map();
  const stores = new Map((manifest.stores ?? []).map((s) => [s.id, projectTarget(s, manifest.home)]));
  for (const s of stores.values()) {
    if (s.aside) say(`project not here: ${s.root}; its files go to ${s.aside} — clone it there and restore again`);
  }
  let inProjects = 0;
  for (const [name, raw] of entries) {
    const p = /^projects\/([^/]+)\/(.+)$/.exec(name);
    if (p) {
      const [, id, rel] = p;
      const store = stores.get(id);
      if (!store || !PROJECT_REL.test(rel)) { partial = true; say(`refused, not a project file a backup writes: ${name}`); continue; }
      const root = store.aside ?? store.root;
      const dest = path.join(root, ...rel.split('/'));
      try {
        if (throughLink(root, dest)) { say(`linked here, not written: ${dest}`); continue; }
        const held = readMaybe(dest);
        const seed = held !== null && isHostSeed(PROJECT_LAYERS.reduce((r, l) => (r.startsWith(`${l}/`) ? r.slice(l.length + 1) : r), rel), held);
        const landing = held === null || seed ? { dest, write: !held?.equals(raw) } : restoredLanding(path.dirname(dest), path.basename(dest), raw);
        if (landing.write && !dryRun) {
          mkdirSync(path.dirname(landing.dest), { recursive: true });
          writeBytes(landing.dest, raw, { exclusive: !seed });
        }
        if (landing.write) inProjects += 1;
        if (landing.write && landing.dest !== dest) say(`kept yours (differs from the backup): ${dest}; the backup's is ${path.basename(landing.dest)}`);
      } catch (e) {
        partial = true;
        say(`not restored: ${dest} (${e && e.message})`);
      }
      continue;
    }
    const m = /^(skills|agents|host)\/([^/]+)\/(.+)$/.exec(name);
    if (!m) continue;
    const [, kind, host, tail] = m;
    const rest = kind === 'host' ? tail : `${kind}/${tail}`;   // relative to the host's own dir
    const what = `${host} ${rest}`;
    try {
      const spec = HOSTS.find((h) => h.host === host);
      if (!spec) { partial = true; say(`unknown host ${host}: ${rest} not restored`); continue; }
      const root = spec.configDir();
      const dest = path.join(root, ...rest.split('/'));
      const data = kind === 'host' && (rest === 'context.json' || WIKI_NAMES.includes(rest))
        ? Buffer.from(rewriteHome(raw.toString('utf8'), manifest.home, os.homedir()), 'utf8') : raw;
      if (throughLink(root, dest)) { say(`linked here, not written: ${what}`); continue; }
      const held = readMaybe(dest);
      if (held !== null && held.equals(data)) continue;
      if (held !== null) {
        if (!owned.has(root)) owned.set(root, readOwned(root));
        const { hashes } = owned.get(root);
        if (ownedState(root, rest, hashes) === 'unmodified' || (kind === 'host' && isHostSeed(rest, held))) {
          if (!dryRun) writeBytes(dest, data);
          say(`yours replaces the untouched shipped file: ${what}`);
          written += 1;
          continue;
        }
        // Beside a file the host obeys, a copy would be obeyed too: it lands in `<dir>-restored/`.
        const [top, ...inner] = rest.split('/');
        const side = kind === 'host' && LIVE_DIRS.includes(top) ? path.join(root, `${top}-${RESTORED}`, ...inner) : dest;
        if (throughLink(root, side)) { say(`linked here, not written: ${what}`); continue; }
        const landing = restoredLanding(path.dirname(side), path.basename(side), data);
        if (landing.write && !dryRun) {
          mkdirSync(path.dirname(landing.dest), { recursive: true });
          writeBytes(landing.dest, data, { exclusive: true });
        }
        say(`kept yours (differs from the backup): ${what}${landing.write ? `; the backup's is ${side === dest ? path.basename(landing.dest) : toPosix(path.relative(root, landing.dest))}` : ''}`);
        continue;
      }
      if (!dryRun) {
        mkdirSync(path.dirname(dest), { recursive: true });
        writeBytes(dest, data, { exclusive: true });
      }
      written += 1;
    } catch (e) {
      partial = true;
      say(`not restored: ${what} (${e && e.message})`);
    }
  }
  say(`skills, agents and host files: ${written} written`);
  if (stores.size) say(`projects: ${inProjects} files written`);

  for (const { host, profile } of manifest.installs) {
    try {
      const name = restoredProfile(host, { ...profile, description: `restored from a backup of ${manifest.createdAt}` }, dryRun);
      if (dryRun) { say(`${host}: would rebuild with geneseed profile apply ${name}`); continue; }
      const rc = apply(name);
      if (rc !== 0) { partial = true; say(`${host}: not rebuilt (profile apply exit ${rc}) — run: geneseed profile apply ${name}`); }
    } catch (e) {
      partial = true;
      say(`${host}: not rebuilt (${e && e.message})`);
    }
  }
  for (const l of manifest.links) say(`link to recreate by hand: ${l.host} ${l.kind} ${l.name} -> ${l.target ?? '(dead link)'}`);
  for (const p of manifest.projects) say(`project install to re-run there: ${p.host} ${p.root}`);
  const wiki = readMaybe(sharedPaths().wiki);
  if (wiki !== null && !dryRun) for (const p of missingWikiPaths(wiki.toString('utf8'))) say(`wiki path not found on this machine: ${p}`);
  return partial ? 2 : 0;
}
