/**
 * The project notes, moved to their one folder (the owner's ruling, 2026-11-15).
 *
 * Before the two scopes, a PROJECT install kept every spec-feedback note in its own notebook,
 * which differs per host: `.claude/notebook`, `.bob/notebook`, `.openclaude/notebook`, and
 * `.opencode/notebook` for an OpenCode install older than #590. Those notes were written with no
 * scope, so each counts as a PROJECT note now: on the next emit of that install they are merged
 * into `<project>/notebook/{agent,skill}-notes/`, the one folder every host's step 0 reads.
 *
 * NO LOSS, BY CONSTRUCTION. The merge has no cap (`mergeNotesText`: a line the target already holds
 * exactly is not added twice, and nothing is dropped), the target is read back and must hold every
 * line of the source before the source moves, and the source then moves aside into
 * `<project>/notebook/archived-<sub>/<stamp>/`, beside the target so a removed worktree cannot take
 * the backup with it, as the fold sets a host store aside: never unlinked. A file
 * that cannot be merged (not UTF-8 on either side, a read or write that fails) stays where it was,
 * named in one line. A global install's notebook is the fold's (js/build/fold.mjs `foldNotes`), and
 * a second emit finds nothing to move.
 */
import { isUtf8 } from 'node:buffer';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { NOTES_DIRS } from '../lib/machine-dir.mjs';
import { normcase } from '../lib/paths.mjs';
import { relPosix } from '../lib/text.mjs';
import { archiveStore } from '../hosts/memory-files.mjs';
import {
  excludeProjectNotes, mergeNotesText, projectNotesDir, withLock,
} from '../hosts/spec-feedback.mjs';

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const readUtf8 = (p) => {
  const raw = readFileSync(p);
  if (!isUtf8(raw)) throw new Error('not UTF-8');
  return raw.toString('utf8');
};
// Every line of a note, exact (a CR aside): what the read-back compares.
const linesOf = (text) => new Set(text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim()));

/**
 * Merge `<cfgDir>/notebook/{agent,skill}-notes/*.md` into `<projectRoot>/notebook/…`. Returns
 * `{ moved, kept, archived }`: the files merged and set aside, the files left in place with why,
 * and where the moved ones went. Prints one line when it moved anything and one per file it kept.
 */
export function migrateProjectNotes(cfgDir, projectRoot, say = (s) => process.stdout.write(s)) {
  const report = { moved: [], kept: [], archived: [] };
  // A linked worktree's notes go to its main checkout, as the hook writes them (`projectNotesDir`).
  const target = projectNotesDir(projectRoot);
  for (const sub of NOTES_DIRS) {
    const src = path.join(cfgDir, 'notebook', sub);
    const dst = path.join(target, sub);
    if (normcase(path.resolve(src)) === normcase(path.resolve(dst))) continue;
    let names;
    try { names = readdirSync(src).filter((n) => n.endsWith('.md') && isFile(path.join(src, n))).sort(); } catch { continue; }
    const merged = [];
    for (const name of names) {
      const from = path.join(src, name);
      const to = path.join(dst, name);
      const rel = relPosix(projectRoot, from) || from;
      try {
        const text = readUtf8(from);
        mkdirSync(dst, { recursive: true });
        // Under the capture's own lock: a hook may be adding a note to the same file right now.
        const done = withLock(to, () => {
          const next = mergeNotesText(existsSync(to) ? readUtf8(to) : '', text);
          if (next !== null) writeFileSync(to, next, 'utf8');
          return true;
        });
        if (done !== true) throw new Error('the notes file stayed locked');
        const have = linesOf(readUtf8(to));
        if ([...linesOf(text)].some((l) => !have.has(l))) throw new Error(`${relPosix(projectRoot, to)} does not hold every line`);
        merged.push(name);
      } catch (e) {
        report.kept.push({ rel, why: e.message });
      }
    }
    if (merged.length) {
      // Beside the merge target, not the source: in a linked worktree the source goes with the
      // worktree, and the backup must outlive it.
      const dest = archiveStore(src, (_store, into) => {
        mkdirSync(into, { recursive: true });
        for (const name of merged) renameSync(path.join(src, name), path.join(String(into), name));
      }, path.join(target, `archived-${sub}`));
      report.archived.push(dest);
      report.moved.push(...merged.map((n) => `${sub}/${n}`));
      try { rmdirSync(src); } catch { /* not empty: a kept file, or one that is not a note */ }
    }
  }
  if (report.moved.length) {
    // The notes and their archives stay out of every commit (`.git/info/exclude`, per clone).
    excludeProjectNotes(target);
    say(`[geneseed] notes: merged ${report.moved.length} project note file(s) from `
      + `${relPosix(projectRoot, path.join(cfgDir, 'notebook')) || cfgDir} into ${relPosix(projectRoot, target) || target}/; the originals `
      + `are set aside in ${report.archived.map((a) => relPosix(projectRoot, a) || a).join(', ')}\n`);
  }
  for (const { rel, why } of report.kept) {
    say(`[geneseed] notes: kept ${rel} where it is, not merged into ${relPosix(projectRoot, target) || target}/ (${why}); merge it by hand\n`);
  }
  return report;
}
