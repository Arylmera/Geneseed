/**
 * Retired skill folders — `skills/<name>` that an earlier build rendered under a name this one no
 * longer ships (an `aliases:` marker or a `RETIRED_SKILL_IDS` entry), that no manifest owns, and
 * that no emit would therefore ever prune. The user decided (2026-11-09) that such a folder is
 * Geneseed's leftover, not their change: every canonical global emit moves it aside.
 *
 * An alias is a plain word, so a folder under one may be the user's own (`grill-me` on this very
 * machine is a user skill, and a link). A folder moves only when ALL of these hold:
 *   (a) its name is retired and not a live skill;
 *   (b) no manifest owns a path under it — an owned one is the ordinary prune's;
 *   (c) it, the `skills/` root, and everything inside it are real entries, never a link;
 *   (d) its SKILL.md carries the render's fingerprint (`isRendered`).
 * Anything else stays where it is and `migrate --dry-run` keeps calling it an orphan.
 *
 * Moved, not deleted: to `<cfg>/archived-skills/<name>/<stamp>/`, outside the `skills/` root a
 * host scans (`archiveStore`'s sibling would sit inside it and load again).
 */
import { lstatSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';

import { RETIRED_SKILL_IDS, knownSkillIds, skillAliases } from './source.mjs';
import { isCanonical } from '../hosts/hosts.mjs';
import { archiveStore } from '../hosts/memory-files.mjs';

/** Every name an earlier build shipped a skill folder under and this one does not. */
export function retiredSkillNames({ live = knownSkillIds(), aliases = skillAliases() } = {}) {
  return [...new Set([...aliases.keys(), ...Object.keys(RETIRED_SKILL_IDS)])].filter((n) => !live.includes(n));
}

/** Whether a manifest `owned` list holds `rel` or a path under it. */
export const ownsRel = (owned, rel) => owned.some((o) => o === rel || o.startsWith(`${rel}/`));

const lstat = (p) => { try { return lstatSync(p); } catch { return null; } };

/** (c): `dir` is a real directory and nothing under it is a link. lstat only: a link is never followed. */
function plainTree(dir) {
  const st = lstat(dir);
  if (!st || st.isSymbolicLink() || !st.isDirectory()) return false;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const s = lstat(p);
    if (!s || s.isSymbolicLink()) return false;
    if (s.isDirectory() && !plainTree(p)) return false;
  }
  return true;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * (d): the fingerprint every native skill writer has produced since the first one (Python
 * `build.py`, 2026-06-04, through `js/hosts/native.mjs` today): the file opens
 * `---` / `name: <folder>` / `description: <json.dumps of the description>`, and the body carries
 * the `# {{SKILL}}: <name>` heading every first-party source opens with (anywhere, because an
 * authoring comment may precede it, as `herdr`'s did). The value must parse as a JSON string:
 * a hand-written skill almost always writes it as plain YAML. An alias render carries its
 * target's heading, so the heading's name is not tied to the folder.
 */
export function isRendered(dir, name) {
  let text;
  try { text = readFileSync(path.join(dir, 'SKILL.md'), 'utf8'); } catch { return false; }
  const m = new RegExp(`^---\\r?\\nname: ${escapeRe(name)}\\r?\\ndescription: (".*")\\r?\\n`).exec(text);
  if (!m) return false;
  try { if (typeof JSON.parse(m[1]) !== 'string') return false; } catch { return false; }
  // From the description line's own `\n`, so a frontmatter with no further key closes too.
  const from = m[0].length - 1;
  const close = /\n---\r?\n/.exec(text.slice(from));
  if (!close) return false;
  const body = text.slice(from + close.index + close[0].length);
  return /^# [^:\r\n]{1,40}: [\w.-]+[ \t]*\r?$/m.test(body);
}

/**
 * The retired folders of `cfg` split by what the next canonical emit does with them:
 * `prune` (a-d all hold) and `keep` (unowned, present, but failing c or d). Paths are absolute.
 */
export function retiredSkillFolders(cfg, owned, opts = {}) {
  const prune = [];
  const keep = [];
  const root = path.join(cfg, 'skills');
  const rootStat = lstat(root);
  if (!rootStat) return { prune, keep };
  // A linked `skills/` root (a dotfiles setup) is the user's whole tree: nothing in it moves.
  const linkedRoot = rootStat.isSymbolicLink();
  for (const name of retiredSkillNames(opts)) {
    if (ownsRel(owned, `skills/${name}`)) continue;
    const dir = path.join(root, name);
    if (!lstat(dir)) continue;
    (!linkedRoot && plainTree(dir) && isRendered(dir, name) ? prune : keep).push(dir);
  }
  return { prune, keep };
}

/** Where `pruneRetiredSkills` moves `skills/<name>`: the stamp folder goes under it. */
export const retiredArchiveOf = (cfg, name) => path.join(cfg, 'archived-skills', name);

/**
 * The emit's call, before the skill layer writes (so an alias freed here is claimed in the same
 * emit, and the next one has nothing to do), with the manifest's `owned` from BEFORE this emit.
 * Canonical global installs only: `diff`, Restore and a stray `--config-dir` never move a thing.
 * A failed move warns and leaves the folder; it never fails the emit.
 */
export function pruneRetiredSkills(host, cfg, oldOwned) {
  if (!isCanonical(cfg, host)) return;
  for (const dir of retiredSkillFolders(cfg, oldOwned).prune) {
    const name = path.basename(dir);
    // Raw stream writes, as `pruneOwned`'s: the driver's `withPlatformNewlines` already translates,
    // and `printOut` on top of it would print `\r\r\n` on Windows.
    try {
      const dest = archiveStore(dir, renameSync, retiredArchiveOf(cfg, name));
      process.stdout.write(`[geneseed] ${host}: pruned retired skill skills/${name} (moved to ${dest})\n`);
    } catch (e) {
      process.stderr.write(`[geneseed] WARN: ${host}: could not move retired skill skills/${name} aside (${e.message}); it stays\n`);
    }
  }
}
