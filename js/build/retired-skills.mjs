/**
 * Retired skill folders — `skills/<name>` that an earlier build rendered under a name this one no
 * longer ships (an `aliases:` marker or a `RETIRED_SKILL_IDS` entry), that no manifest owns, and
 * that no emit would therefore ever prune. The user decided (2026-11-09) that such a folder is
 * Geneseed's leftover, not their change: every canonical global emit moves it aside.
 *
 * An alias is a plain word, so a folder under one may be the user's own (`grill-me` on this very
 * machine is a user skill, and a link). A folder moves only when ALL of these hold:
 *   (a) its name is retired and not a live skill, or it is a REVIVED name (below);
 *   (b) no manifest owns a path under it — an owned one is the ordinary prune's;
 *   (c) it, the `skills/` root, and everything inside it are real entries, never a link;
 *   (d) its SKILL.md carries the render's fingerprint (`isRendered`).
 * Anything else stays where it is and `migrate --dry-run` keeps calling it an orphan.
 *
 * A revived name (`REVIVED_SKILL_IDS`) is live again. An unowned render under it is one of two
 * things: the copy an older build wrote before it retired the name, or a file the user edited and
 * a later emit declined to overwrite (`claimer` records that refusal in the manifest's `kept` and
 * drops the file from `owned`). The `kept` record tells them apart:
 *   - nothing under the folder is in `kept`: the older build's copy. It moves aside whether or
 *     not this emit ships the skill. Kit off, that is the cleanup it got while the name was
 *     retired. Kit on, the emit then claims a free folder and writes the current copy, where
 *     `claimer` would otherwise keep the stale file as the user's;
 *   - a path under it is in `kept`: the user's edit. It stays, and `held` hands those `kept`
 *     entries back to the emit, which records them again. A kit-off emit claims nothing under
 *     the folder, so without that carry the record would lapse and the next emit would take the
 *     edit for an old copy.
 * Only revived names get this: an unowned render of any other live skill is never a candidate.
 *
 * Moved, not deleted: to `<cfg>/archived-skills/<name>/<stamp>/`, outside the `skills/` root a
 * host scans (`archiveStore`'s sibling would sit inside it and load again).
 */
import { lstatSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';

import { RETIRED_SKILL_IDS, REVIVED_SKILL_IDS, THEMES, knownSkillIds, skillAliases } from './source.mjs';
import { GLOBAL_MANIFEST, isCanonical } from '../hosts/hosts.mjs';
import { archiveStore } from '../hosts/memory-files.mjs';

/**
 * Every name an earlier build shipped a skill folder under and this one does not, plus every
 * revived name, whose unowned render is an older build's copy whether or not it ships today.
 */
export function retiredSkillNames({ live = knownSkillIds(), aliases = skillAliases(), revived = REVIVED_SKILL_IDS } = {}) {
  const gone = [...aliases.keys(), ...Object.keys(RETIRED_SKILL_IDS)].filter((n) => !live.includes(n));
  return [...new Set([...gone, ...Object.keys(revived)])];
}

/** Whether a manifest `owned` list holds `rel` or a path under it. */
export const ownsRel = (owned, rel) => owned.some((o) => o === rel || o.startsWith(`${rel}/`));

const lstat = (p) => { try { return lstatSync(p); } catch { return null; } };

/**
 * (c): `dir` is a real directory and nothing under it is a link. lstat only: a link is never
 * followed. A folder it cannot list is not plain: its reason goes into `unreadable`.
 */
function plainTree(dir, readdir, unreadable) {
  const st = lstat(dir);
  if (!st || st.isSymbolicLink() || !st.isDirectory()) return false;
  let names;
  try { names = readdir(dir); } catch (e) { unreadable.push(`${dir} (${e.message})`); return false; }
  for (const name of names) {
    const p = path.join(dir, name);
    const s = lstat(p);
    if (!s || s.isSymbolicLink()) return false;
    if (s.isDirectory() && !plainTree(p, readdir, unreadable)) return false;
  }
  return true;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every theme's `SKILL` label — the `{{SKILL}}` of a rendered heading — read off `themes/*.json`. */
let labelsCache = null;
export function skillLabels(themes = THEMES) {
  if (themes === THEMES && labelsCache) return labelsCache;
  const labels = new Set();
  for (const f of readdirSync(themes).filter((n) => n.endsWith('.json') && !n.startsWith('_'))) {
    try {
      const v = JSON.parse(readFileSync(path.join(themes, f), 'utf8')).SKILL;
      if (typeof v === 'string' && v) labels.add(v);
    } catch { /* a broken theme labels nothing */ }
  }
  if (themes === THEMES) labelsCache = labels;
  return labels;
}

/**
 * (d): the fingerprint every native skill writer has produced since the first one (Python
 * `build.py`, 2026-06-04, through `js/hosts/native.mjs` today):
 *   - the file opens `---` / `name: <folder>` / `description: <json.dumps of it>`, and the value
 *     parses as a JSON string — a hand-written skill almost always writes plain YAML;
 *   - outside any code fence, the body holds the `# {{SKILL}}: <id>` heading every first-party
 *     source opens with, where the label is some theme's `SKILL` value and the id is the folder's
 *     own name, or the skill it aliases (an alias render carries its target's body). Anywhere in
 *     the body, because an authoring comment may precede it, as `herdr`'s did.
 * A "Step 1: …" or "Grill Me: …" heading in a user's skill matches neither half of that.
 */
export function isRendered(dir, name, { aliases = skillAliases(), labels = skillLabels() } = {}) {
  let text;
  try { text = readFileSync(path.join(dir, 'SKILL.md'), 'utf8'); } catch { return false; }
  const m = new RegExp(`^---\\r?\\nname: ${escapeRe(name)}\\r?\\ndescription: (".*")\\r?\\n`).exec(text);
  if (!m) return false;
  try { if (typeof JSON.parse(m[1]) !== 'string') return false; } catch { return false; }
  // From the description line's own `\n`, so a frontmatter with no further key closes too.
  const from = m[0].length - 1;
  const close = /\n---\r?\n/.exec(text.slice(from));
  if (!close) return false;
  const ids = new Set([name, aliases.get(name)].filter(Boolean));
  let fenced = false;
  for (const line of text.slice(from + close.index + close[0].length).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const h = /^# (.+?): (\S+)\s*$/.exec(line);
    if (h && labels.has(h[1]) && ids.has(h[2])) return true;
  }
  return false;
}

/**
 * The retired folders of `cfg` split by what the next canonical emit does with them:
 * `prune` (a-d all hold) and `keep` (unowned, present, but failing c or d). Paths are absolute.
 * `unreadable` names each folder kept because it could not be listed, with the reason.
 * `held` lists the manifest `kept` entries under a revived folder that stays as the user's edit
 * (see the module docblock); the emit records them again. Neither pruned nor an orphan.
 * `opts.readdir` is the listing call, injectable so a test can make a folder unreadable.
 * `opts.kept` is the manifest's `kept` from BEFORE this emit; by default it is read from `cfg`.
 */
export function retiredSkillFolders(cfg, owned, opts = {}) {
  const { readdir = readdirSync, kept = recordedKept(cfg), revived = REVIVED_SKILL_IDS } = opts;
  const prune = [];
  const keep = [];
  const unreadable = [];
  const held = [];
  const root = path.join(cfg, 'skills');
  const rootStat = lstat(root);
  if (!rootStat) return { prune, keep, unreadable, held };
  // A linked `skills/` root (a dotfiles setup) is the user's whole tree: nothing in it moves.
  const linkedRoot = rootStat.isSymbolicLink();
  const aliases = opts.aliases ?? skillAliases();
  for (const name of retiredSkillNames({ ...opts, aliases, revived })) {
    const rel = `skills/${name}`;
    const dir = path.join(root, name);
    // Before the `owned` skip: an owned side file (a LICENSE) must not hide the kept SKILL.md
    // beside it, or the record lapses in that emit and the next one archives the edit.
    if (Object.hasOwn(revived, name) && ownsRel(kept, rel) && lstat(dir)) {
      held.push(...kept.filter((k) => k === rel || k.startsWith(`${rel}/`)));
      continue;
    }
    if (ownsRel(owned, rel)) continue;
    if (!lstat(dir)) continue;
    (!linkedRoot && plainTree(dir, readdir, unreadable) && isRendered(dir, name, { aliases }) ? prune : keep).push(dir);
  }
  return { prune, keep, unreadable, held };
}

/** The manifest's `kept` list in `cfg`, or `[]` when there is no readable manifest. */
function recordedKept(cfg) {
  try {
    const man = JSON.parse(readFileSync(path.join(cfg, GLOBAL_MANIFEST), 'utf8'));
    return Array.isArray(man?.kept) ? man.kept.filter((k) => typeof k === 'string') : [];
  } catch { return []; }
}

/** Where `pruneRetiredSkills` moves `skills/<name>`: the stamp folder goes under it. */
export const retiredArchiveOf = (cfg, name) => path.join(cfg, 'archived-skills', name);

/**
 * The emit's call, before the skill layer writes (so an alias freed here is claimed in the same
 * emit, and the next one has nothing to do), with the manifest's `owned` from BEFORE this emit.
 * Canonical global installs only: `diff`, Restore and a stray `--config-dir` never move a thing.
 * A folder it cannot read, or a failed move, warns and leaves the folder; it never fails the emit.
 * Raw stream writes, as `pruneOwned`'s: the driver's `withPlatformNewlines` already translates,
 * and `printOut` on top of it would print `\r\r\n` on Windows.
 * Returns `held`: the `kept` entries of user edits under revived names, for the emit to record
 * again in its manifest (`[]` off the canonical path, where nothing is ever pruned). A survey that
 * throws moves nothing and holds every recorded `kept` entry under a revived name, so a failed
 * run never lapses one.
 */
export function pruneRetiredSkills(host, cfg, oldOwned) {
  if (!isCanonical(cfg, host)) return [];
  let found;
  try { found = retiredSkillFolders(cfg, oldOwned); } catch (e) {
    process.stderr.write(`[geneseed] WARN: ${host}: could not survey retired skills (${e.message}); nothing moved\n`);
    return recordedKept(cfg).filter((k) => Object.keys(REVIVED_SKILL_IDS).some((n) => k.startsWith(`skills/${n}/`)));
  }
  for (const u of found.unreadable) {
    process.stderr.write(`[geneseed] WARN: ${host}: could not read retired skill folder ${u}; it stays\n`);
  }
  for (const dir of found.prune) {
    const name = path.basename(dir);
    try {
      const dest = archiveStore(dir, renameSync, retiredArchiveOf(cfg, name));
      process.stdout.write(`[geneseed] ${host}: pruned retired skill skills/${name} (moved to ${dest})\n`);
    } catch (e) {
      process.stderr.write(`[geneseed] WARN: ${host}: could not move retired skill skills/${name} aside (${e.message}); it stays\n`);
    }
  }
  return found.held;
}
