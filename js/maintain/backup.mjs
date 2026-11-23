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
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { installProfile } from '../build/profile.mjs';
import { RETIRED_RULES_FILE } from '../build/rule-decide.mjs';
import { knownSkillIds, ROOT, skillAliases } from '../build/source.mjs';
import { GLOBAL_MANIFEST } from '../hosts/hosts.mjs';
import { hashesOf, ownedState } from '../hosts/owned.mjs';
import { installState, installTargets } from '../hosts/installs.mjs';
import { machineDir, sharedPaths } from '../lib/machine-dir.mjs';
import { USER_LOOP_DIRS } from '../loop/catalog.mjs';
import { personalProfilesDir, profileFromInstall } from './profiles.mjs';

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
