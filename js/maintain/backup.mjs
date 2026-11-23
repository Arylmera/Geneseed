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

import { foldHost, foldSummary } from '../build/fold.mjs';
import { installProfile } from '../build/profile.mjs';
import { RETIRED_RULES_FILE } from '../build/rule-decide.mjs';
import { knownSkillIds, ROOT, skillAliases } from '../build/source.mjs';
import { SESSION_SEEDS } from '../build/stubs.mjs';
import { EXCLUDES_FILE, GLOBAL_MANIFEST, HOSTS } from '../hosts/hosts.mjs';
import { readFoldState } from '../hosts/memory-files.mjs';
import { hashesOf, ownedState } from '../hosts/owned.mjs';
import { installState, installTargets } from '../hosts/installs.mjs';
import { printErr, printOut, writeBytes, writeTextAtomic } from '../lib/fs.mjs';
import { jsonDumpsIndent } from '../lib/json.mjs';
import { machineDir, NOTES_DIRS, sharedPaths, WIKI_NAMES } from '../lib/machine-dir.mjs';
import { readZip, writeZip } from '../lib/zip.mjs';
import { USER_LOOP_DIRS } from '../loop/catalog.mjs';
import { personalProfilesDir, profileFromInstall, saveProfile } from './profiles.mjs';
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

const toPosix = (p) => p.split(path.sep).join('/');

/** Every regular file under `dir`, as `/`-separated paths relative to it, sorted. Links skipped. */
function filesUnder(dir) {
  const out = [];
  const walk = (d, pre) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
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

/** One global install's own skills and agents, the links it holds, and the folders to flag. */
function collectHost(host, root) {
  const { owned, hashes } = readOwned(root);
  // A file Geneseed wrote that the user then edited: a fresh install would write over it.
  const edited = (rel) => ownedState(root, rel, hashes) === 'modified';
  const shipped = new Set([...knownSkillIds(), ...skillAliases().keys()]);
  const files = []; const links = []; const ambiguous = [];
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
    if (!st.isDirectory()) continue;
    const inside = filesUnder(full);
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
    if (!st) continue;
    if (st.isSymbolicLink()) {
      let target = null;
      try { target = realpathSync.native(full); } catch { /* dead link */ }
      links.push({ host, kind: 'agent', name: f.slice(0, -3), target });
    } else if (st.isFile()) {
      const rel = `agents/${f}`;
      if (owned.includes(rel) && !edited(rel)) continue;
      if (owned.includes(rel)) ambiguous.push(`agents/${host}/${f}`);
      files.push({ name: `agents/${host}/${f}`, file: full });
    }
  }
  return { files, links, ambiguous };
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
 * `targets` is the seam a test hands its sandboxed installs through.
 * @param {{ now?: Date, targets?: [string, string, string][] | null }} [opts]
 */
export function collectBackup({ now = new Date(), targets = null } = {}) {
  const tier = machineDir();
  const { files: tierFiles, skipped } = collectTier(tier);
  const files = [...tierFiles]; const links = []; const ambiguous = [];
  const installs = []; const projects = [];
  for (const [host, scope, root] of targets ?? activeTargets()) {
    if (scope !== 'global') { projects.push({ host, root }); continue; }
    const h = collectHost(host, root);
    files.push(...h.files); links.push(...h.links); ambiguous.push(...h.ambiguous);
    installs.push({ host, profile: profileFromInstall(installProfile(host, 'global', root)) });
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
    installs, projects, links, skipped, ambiguous,
  };
  return { entries, manifest };
}

/** `geneseed-backup-<machine>-<YYYYMMDD-HHMM>.zip`: two machines' backups never share a name. */
function defaultBackupName(now) {
  const host = os.hostname().replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'machine';
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `geneseed-backup-${host}-${stamp}.zip`;
}

/** The lines every backup prints after its total: what stayed behind, and why. */
function backupNotes(manifest) {
  const out = [];
  if (manifest.skipped.length) out.push(`[backup] not carried (machine state or another tool's): ${manifest.skipped.join(', ')}`);
  for (const l of manifest.links) out.push(`[backup] link not copied: ${l.host} ${l.kind} ${l.name} -> ${l.target ?? '(dead link)'}`);
  for (const p of manifest.projects) out.push(`[backup] project install not replayed: ${p.host} ${p.root}`);
  for (const a of manifest.ambiguous) out.push(`[backup] carried, edited or named like a shipped one: ${a}`);
  return out;
}

/**
 * `geneseed backup [--out <file>] [--dry-run]`. 0 written (or previewed), 1 refused.
 * @param {{ out?: string, dryRun?: boolean }} args
 */
export function cmdBackup(args = {}) {
  const now = new Date();
  let backup;
  try { backup = collectBackup({ now }); } catch (e) {
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
  printOut(`[backup] wrote ${out}: ${entries.length} files, ${total} bytes\n`);
  for (const l of notes) printOut(`${l}\n`);
  printOut('[backup] the archive is a plain copy of your own files: keep it somewhere only you can read\n');
  return 0;
}

// --- restore -------------------------------------------------------------------------------

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `text` with the home `fromHome` replaced by `toHome` inside JSON(C) string literals only, in the
 * spelling each was written in: `/`, `\`, or the JSON-escaped `\\`. Comments are copied as they
 * are. A prefix matches only at a path boundary, so `/home/old` leaves `/home/older` alone; a
 * drive-letter home matches without regard to case, as Windows does.
 * @param {string} text
 * @param {string} fromHome
 * @param {string} toHome
 */
export function rewriteHome(text, fromHome, toHome) {
  if (!fromHome || !toHome || fromHome === toHome) return text;
  const fwd = (p) => p.replaceAll('\\', '/');
  const back = (p) => p.replaceAll('/', '\\');
  const esc = (p) => back(p).replaceAll('\\', '\\\\');
  const flags = /^[A-Za-z]:/.test(fromHome) ? 'gi' : 'g';
  const pairs = [[esc(fromHome), esc(toHome)], [back(fromHome), back(toHome)], [fwd(fromHome), fwd(toHome)]]
    .map(([a, b]) => [new RegExp(`${escapeRe(a)}(?=$|[\\\\/])`, flags), b]);
  const swap = (lit) => pairs.reduce((s, [re, b]) => s.replace(re, () => b), lit);
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
      out += `"${swap(text.slice(i + 1, j))}"`; i = j + 1;
    } else {
      out += text[i]; i += 1;
    }
  }
  return out;
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

const lf = (b) => b.toString('utf8').replaceAll('\r\n', '\n');
const isRulesSeed = (b) => lf(b) === SESSION_SEEDS['user-rules.md'].replaceAll('\r\n', '\n');
const sectionsOf = (text) => text.replaceAll('\r\n', '\n').split(/^(?=## )/m).filter((s) => s.trim());

/** Where a tier file goes in the staging folder the fold reads as host `restored`, or null. */
function stagedRel(rel) {
  const parts = rel.split('/');
  if (parts[0] === 'memory') {
    if (parts.length === 2 && rel.endsWith('.md') && parts[1] !== 'MEMORY.md') return rel;
    if (parts.length === 3 && parts[1] === 'agents' && rel.endsWith('.md')) return rel;
    return null;
  }
  if (parts[0] === 'notes' && parts.length === 3 && NOTES_DIRS.includes(parts[1])) return `notebook/${parts[1]}/${parts[2]}`;
  if (rel === 'PROFILE.md' || WIKI_NAMES.includes(rel)) return rel;
  return null;
}

/**
 * Put the archive's `tier/` files into this machine's tier, never overwriting.
 *
 * WHAT THE FOLD ALREADY KNOWS, THE FOLD DOES. Facts, agent lessons, notes, the profile, the wiki
 * and an in-use rules file are staged in a temp folder laid out as a host store and folded in as
 * host `restored` (`foldHost`): a differing fact lands as `<name>-restored.md`, a rule waits in
 * the draft, a differing profile gets a pointer. An in-use `excludes.json` is staged too: the fold
 * appends the paths the shared list lacks. Wiring them into repos is the next emit's, against the
 * real installs.
 *
 * The rest is decided here: an absent file or a seed is copied, `.fold-state.json` merges by
 * key with this machine's decision kept, the retired-rules record gains its missing sections, and
 * any other differing file lands beside the original under the same `-restored` chain.
 * `memory/MEMORY.md` and `topics/` are not copied: the fold rebuilds the index from the facts.
 * @param {{ manifest: any, entries: Map<string, Buffer> }} backup
 * @param {{ dryRun?: boolean }} [opts]
 */
export function restoreTier({ manifest, entries }, { dryRun = false } = {}) {
  const shared = sharedPaths();
  const tier = shared.root;
  const home = os.homedir();
  const profilesRel = path.relative(tier, personalProfilesDir()).split(path.sep).join('/');
  const rewrites = (rel) => WIKI_NAMES.includes(rel) || rel === EXCLUDES_FILE
    || (rel.startsWith(`${profilesRel}/`) && rel.endsWith('.json'));
  const copied = []; const merged = []; const same = []; const failed = [];
  const staging = mkdtempSync(path.join(os.tmpdir(), 'gs-restore-'));
  const stage = (rel, data) => {
    const p = path.join(staging, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeBytes(p, data);
  };
  const write = (dest, data, exclusive) => {
    if (dryRun) return;
    mkdirSync(path.dirname(dest), { recursive: true });
    writeBytes(dest, data, { exclusive });
  };
  let excludesHeld = false;
  let excludesBackup = null;
  try {
    for (const [name, raw] of entries) {
      if (!name.startsWith('tier/')) continue;
      const rel = name.slice('tier/'.length);
      const data = rewrites(rel) ? Buffer.from(rewriteHome(raw.toString('utf8'), manifest.home, home), 'utf8') : raw;
      const dest = path.join(tier, ...rel.split('/'));
      const held = readMaybe(dest);
      if (held !== null && held.equals(data)) { same.push(rel); continue; }
      if (rel === 'memory/MEMORY.md' || rel.startsWith('memory/topics/')) continue;
      if (stagedRel(rel)) {
        if (held !== null && !restoredLanding(path.dirname(dest), path.basename(dest), data).write) { same.push(rel); continue; }
        stage(stagedRel(rel), data);
        continue;
      }
      if (rel === 'user-rules.md') {
        if (held === null || isRulesSeed(held)) { write(dest, data, held === null); copied.push(rel); } else stage(rel, data);
        continue;
      }
      if (rel === EXCLUDES_FILE) {
        excludesBackup = data;
        if (held === null) { write(dest, data, true); copied.push(rel); } else excludesHeld = true;
        continue;
      }
      if (held === null) { write(dest, data, true); copied.push(rel); continue; }
      if (rel === '.fold-state.json') {
        const mine = readFoldState(shared);
        const theirs = JSON.parse(data.toString('utf8'));
        const add = Object.keys(theirs.items ?? {}).filter((k) => !Object.hasOwn(mine.items, k));
        if (!add.length) { same.push(rel); continue; }
        for (const k of add) mine.items[k] = theirs.items[k];
        if (!dryRun) writeTextAtomic(shared.foldState, `${jsonDumpsIndent(mine)}\n`);
        merged.push(rel);
        continue;
      }
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
    }
    // The fold shares the paths the tier lacks. Its wiring half writes into a repo only for a real
    // host (claude, openclaude, bob); for `restored` it touches the staging folder alone.
    if (excludesHeld) stage(EXCLUDES_FILE, excludesBackup);
    const report = foldHost({ host: RESTORED, cfgDir: staging, shared, dryRun });
    failed.push(...report.failed);
    if (excludesHeld && report.excludes) merged.push(EXCLUDES_FILE);
    const folded = foldSummary({ ...report, excludes: 0, wired: 0, wiredPaths: [], archived: null, stayed: [] });
    return { copied, merged, same, failed, folded, notices: report.notices };
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
    try { if (isDeepStrictEqual(JSON.parse(held.toString('utf8')), profile)) return name; } catch { /* not ours: next name */ }
  }
}

/** Every absolute path a wiki manifest names that does not exist here. Comments are skipped. */
function missingWikiPaths(text) {
  const out = [];
  const strings = [];
  for (const m of text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    try { strings.push(JSON.parse(`"${m[1]}"`)); } catch { /* not a JSON string */ }
  }
  for (const s of strings) {
    if (!/^([A-Za-z]:[\\/]|\/|~[\\/])/.test(s)) continue;
    const p = s.startsWith('~') ? path.join(os.homedir(), s.slice(2)) : s;
    if (!lstatMaybe(p)) out.push(p);
  }
  return out;
}

/**
 * `geneseed restore <file> [--dry-run]`, on a machine where Geneseed is installed.
 * 0 all restored; 1 refused, nothing written; 2 partial — a host not rebuilt or a tier step that
 * failed, each named. `deps.apply` is the seam a test stubs `profile apply` through.
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

  const t = restoreTier(backup, { dryRun });
  say(`tier: ${t.copied.length} copied, ${t.merged.length} merged beside yours, ${t.same.length} already here`);
  for (const m of t.merged) say(`merged: ${m}`);
  if (t.folded) say(`folded: ${t.folded}`);
  for (const n of t.notices) say(n);
  for (const f of t.failed) { partial = true; say(`tier step failed: ${f}`); }

  let written = 0;
  for (const [name, data] of entries) {
    const m = /^(skills|agents)\/([^/]+)\/(.+)$/.exec(name);
    if (!m) continue;
    const [, kind, host, rest] = m;
    const spec = HOSTS.find((h) => h.host === host);
    if (!spec) { partial = true; say(`unknown host ${host}: ${kind}/${rest} not restored`); continue; }
    const dest = path.join(spec.configDir(), kind, ...rest.split('/'));
    const held = readMaybe(dest);
    if (held !== null) {
      if (!held.equals(data)) say(`kept yours (differs from the backup): ${host} ${kind}/${rest}`);
      continue;
    }
    if (!dryRun) {
      mkdirSync(path.dirname(dest), { recursive: true });
      writeBytes(dest, data, { exclusive: true });
    }
    written += 1;
  }
  say(`skills and agents: ${written} written`);

  for (const { host, profile } of manifest.installs) {
    const name = restoredProfile(host, { ...profile, description: `restored from a backup of ${manifest.createdAt}` }, dryRun);
    if (dryRun) { say(`${host}: would rebuild with geneseed profile apply ${name}`); continue; }
    const rc = apply(name);
    if (rc !== 0) { partial = true; say(`${host}: not rebuilt (profile apply exit ${rc}) — run: geneseed profile apply ${name}`); }
  }
  for (const l of manifest.links) say(`link to recreate by hand: ${l.host} ${l.kind} ${l.name} -> ${l.target ?? '(dead link)'}`);
  for (const p of manifest.projects) say(`project install to re-run there: ${p.host} ${p.root}`);
  const wiki = readMaybe(sharedPaths().wiki);
  if (wiki !== null && !dryRun) for (const p of missingWikiPaths(wiki.toString('utf8'))) say(`wiki path not found on this machine: ${p}`);
  return partial ? 2 : 0;
}
