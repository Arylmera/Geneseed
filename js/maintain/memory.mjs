/**
 * `geneseed memory` — the memory store from a terminal.
 *
 * WHY THIS VERB IS NEW RATHER THAN PORTED. The reference had no `memory` subcommand: a fact
 * could be written by the `learn` hook and deleted from the web console, and there was no
 * third way. So the semantics of `list` and `rm` are the DELETE ENDPOINT's, deliberately and field for
 * field — the same reserved names, the same "a bare slug, never a path" rule, the same
 * index line dropped from MEMORY.md after the file goes — because two ways to remove a fact
 * that disagree about what a fact is would be worse than one way.
 *
 * WHERE IT PARTS COMPANY WITH THE ENDPOINT, AND WHY. Two places, both forced by the
 * difference between a browser talking to a running server and a person typing in a shell:
 *
 *   * THE STORE IS RESOLVED, NOT CONFIGURED. The endpoint is always `<target>/memory`,
 *     because a server has a target. A CLI has a cwd, so this takes the resolver every other
 *     terminal-side reader of the store already uses — `$GENESEED_MEMORY`, then
 *     `$GENESEED_HARNESS`, then a project install in the cwd, then the shared tier, then the
 *     OpenCode config store — with
 *     `--memory` as the explicit override, and the only way to a `memory/` no install owns.
 *     `status` prints the answer of that same resolver, so the two agree about which store
 *     is "the" store.
 *   * THE RESERVED-NAME CHECK IS CASE-INSENSITIVE, and the web endpoints use this one. On a
 *     case-insensitive filesystem — every Windows install and the default macOS one — an
 *     exact `MEMORY`/`README` compare let `rm memory` resolve to the index file, pass the
 *     guard, and delete the thing the agent reads at session start. The endpoint once had
 *     that exact compare; it now calls `memoryDelete` from here.
 *
 * `memoryDropIndex` is the hook module's, not a copy: writing the fact and unwriting its
 * index line are two halves of one format, and the half that writes lives there.
 *
 * `rm` ARCHIVES BY DEFAULT. A removed fact moves into `archive/` (`archiveFact`, the helper
 * learn uses), so a slip of the keyboard or a click in the console is reversible; only
 * `--purge` unlinks. `--archived` points `list` and `rm` at `archive/` itself, and a file
 * there can only be purged — it has nowhere further to go.
 *
 * `consolidate` IS THE BY-HAND DOOR TO THE INDEX REBUILD, AND IT HOLDS NO REBUILD OF ITS OWN.
 * The other door is `geneseed-hook learn --consolidate`, which the specs once told a reader
 * to type as `geneseed learn --consolidate` — a command this binary refuses by design: `learn`
 * spawns the model CLI, so the whole verb lives in the hook binary (ADR 0002), and hook verbs
 * are the host's to run, never a person's. The rebuild itself is pure filesystem work, so it
 * is legal here. Both doors call `consolidateMemory` inside `recordOwnWrites` — the
 * `memoryDelete` precedent: one implementation, two entries. What differs is the SURFACE, in
 * three places: the report line carries the `[memory]` prefix on stdout where the hook prints
 * `[learn]` on stderr; with no store this exits 1 with the verb's shared refusal where the
 * hook exits 0; and a fact name, `--archived` or `--purge` is a usage refusal (exit 2),
 * because a rebuild takes none of them and silently ignoring `--purge` would be a lie.
 */
import { readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import { archiveFact, consolidateMemory, isReservedStem, memoryDropIndex, readFacts } from '../hosts/memory-files.mjs';
import { searchLines } from '../hosts/memory-search.mjs';
import { recordOwnWrites } from '../hosts/store-watch.mjs';
import { consolidatePreview, decidePending, readPlan, restoreFact } from '../hosts/memory-consolidate.mjs';
import { resolveMemoryDir } from '../hosts/hosts.mjs';
import { printOut, printErr, isFile } from '../lib/fs.mjs';

/** Whether `name` is a fact this verb may act on — the endpoint's rule, plus the case fold. */
export function isFactName(name) {
  return Boolean(name) && !name.includes('/') && !name.includes('\\')
    && ![...name].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)
    && !isReservedStem(name);
}

/**
 * The removable facts in `dir`, as bare slugs, sorted.
 *
 * DERIVED FROM `isFactName` RATHER THAN FROM ITS OWN FILTER, so a listing can never offer a
 * name the removal then refuses, and can never hide one it would accept.
 */
export function memoryFacts(dir) {
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((n) => n.endsWith('.md') && isFile(path.join(dir, n)))
    .map((n) => n.slice(0, -3)).filter(isFactName).sort();
}

/**
 * Take a fact out of the store and its line out of the index. Archived into `archive/` unless
 * `purge`, which unlinks it. Returns where it went (the archive path, or '' when purged), or
 * null when `name` is not a fact here.
 */
export function memoryDelete(dir, name, purge = false) {
  if (!isFactName(name)) return null;
  const p = path.join(dir, `${name}.md`);
  if (!isFile(p)) return null;
  return recordOwnWrites(path.dirname(dir), () => {
    let dest = '';
    if (purge) unlinkSync(p);
    else dest = archiveFact(dir, name);
    memoryDropIndex(dir, name);
    return dest;
  });
}

/** Unlink `archive/<name>.md`. True when a file went. The archive has no index to update. */
export function memoryPurgeArchived(dir, name) {
  if (!isFactName(name)) return false;
  const p = path.join(dir, 'archive', `${name}.md`);
  if (!isFile(p)) return false;
  unlinkSync(p);
  return true;
}

/** The verb. */
export function cmdMemory(args) {
  const dir = resolveMemoryDir(args.memory);
  if (dir === null) {
    // The resolver answers null for "no store anywhere on the chain", which is also what an
    // explicit `--memory` that is not a directory gives — so the message names both.
    printErr('[memory] no memory store found. Pass --memory <dir>, or run this from a project '
      + 'install.\n');
    return 1;
  }
  if (args.action === 'consolidate') {
    if (args.name || args.archived || args.purge) {
      printErr('[memory] consolidate rebuilds the whole index: it takes no fact name, '
        + '--archived or --purge.\n');
      return 2;
    }
    if (args.dryRun) {
      const p = consolidatePreview(dir);
      printOut(`[memory] dry run on ${dir}: +${p.added.length} would be indexed, -${p.pruned.length} pruned, `
        + `${p.near.length} near-duplicate pair(s); nothing written\n`);
      for (const [a, b, sim] of p.near) printOut(`  near-duplicate: ${a} <-> ${b} (${sim.toFixed(2)})\n`);
      return 0;
    }
    const report = recordOwnWrites(path.dirname(dir), () => consolidateMemory(dir));
    printOut(`[memory] consolidated ${dir}: +${report.added.length} indexed, `
      + `-${report.pruned.length} pruned, `
      + `${report.duplicates.length} duplicate description(s)\n`);
    for (const [a, b] of report.duplicates) printOut(`  duplicate: ${a} <-> ${b}\n`);
    return 0;
  }
  if (['plan', 'apply', 'reject', 'restore'].includes(args.action)) return cleanupVerb(dir, args);
  const where = args.archived ? path.join(dir, 'archive') : dir;
  if (args.action === 'search') {
    // The map lists only the largest topics (O10), so this is the way to every fact: the same BM25 the
    // learn prompt ranks by (`./memory-search.mjs`), over slug, description, topic and body.
    const query = String(args.name ?? '').trim();
    if (!query) {
      printErr('[memory] search needs the words to look for: geneseed memory search "<words>".\n');
      return 2;
    }
    // The parser checks `--limit` is an int but hands it over as a string (bin/geneseed-cli.mjs `parse`).
    const n = Number(args.limit);
    const limit = Number.isInteger(n) && n > 0 ? n : 10;
    const lines = searchLines(readFacts(where), query, limit);
    if (!lines.length) {
      printOut(`[memory] ${where}: no fact matches "${query}".\n`);
      return 0;
    }
    printOut(`[memory] ${where} (open a fact as <slug>.md there)\n`);
    for (const line of lines) printOut(`  ${line.slice(2)}\n`);
    return 0;
  }
  if (args.action === 'list') {
    const facts = memoryFacts(where);
    if (!facts.length) {
      printOut(`[memory] ${where}: no facts.\n`);
      return 0;
    }
    printOut(`[memory] ${where}\n`);
    for (const name of facts) printOut(`  ${name}\n`);
    return 0;
  }
  if (!args.name) {
    printErr('[memory] rm needs the name of a fact.\n');
    return 2;
  }
  if (args.archived && !args.purge) {
    printErr('[memory] an archived fact can only be purged: add --purge to delete it.\n');
    return 2;
  }
  const done = args.archived ? (memoryPurgeArchived(dir, args.name) ? '' : null)
    : memoryDelete(dir, args.name, Boolean(args.purge));
  if (done === null) {
    // ONE MESSAGE FOR BOTH REFUSALS, which is the endpoint's shape too — it raises the same
    // `NotFound(name)` for a reserved name, a name with a separator and a fact that is not
    // there. Telling a caller that `MEMORY` exists but is protected is a distinction this
    // verb has no reason to draw.
    printErr(`[memory] no such fact '${args.name}' in ${where}.\n`);
    return 1;
  }
  printOut(`[memory] ${where}\n`);
  printOut(done ? `[memory] archived ${args.name} -> ${done}\n` : `[memory] deleted ${args.name}.\n`);
  return 0;
}

/**
 * `plan`, `apply`, `reject` and `restore`: the user's half of the cleanup (js/hosts/memory-consolidate.mjs). The
 * learn model applies the actions it is sure of and leaves the doubtful ones in the plan; these show them and
 * decide them. All filesystem work, so legal in this binary. `apply` copies the whole store aside first.
 */
function cleanupVerb(dir, args) {
  const name = String(args.name ?? '').trim();
  if (args.action === 'plan') {
    const { pending, at } = readPlan(dir);
    if (!pending.length) {
      printOut(`[memory] ${dir}: nothing waits for you${at ? ` (last cleanup ${at.slice(0, 10)})` : ''}.\n`);
      return 0;
    }
    printOut(`[memory] ${dir}: ${pending.length} cleanup action(s) wait for you (apply or reject <name>, or --all)\n`);
    for (const a of pending) printOut(`  ${a.action} ${a.slug}${a.into ? ` into ${a.into}` : ''}${a.reason ? ` (${a.reason})` : ''}\n`);
    return 0;
  }
  if (args.action === 'restore') {
    if (!name || !isFactName(name)) {
      printErr('[memory] restore needs the name of an archived fact (geneseed memory list --archived).\n');
      return 2;
    }
    const got = recordOwnWrites(path.dirname(dir), () => {
      const r = restoreFact(dir, name);
      if (r.slug) consolidateMemory(dir);
      return r;
    });
    if (got.error) {
      printErr(`[memory] ${got.error}.\n`);
      return 1;
    }
    printOut(`[memory] restored ${got.slug} into ${dir}\n`);
    return 0;
  }
  if (!name && !args.all) {
    printErr(`[memory] ${args.action} needs the name of a waiting action, or --all (geneseed memory plan).\n`);
    return 2;
  }
  const r = recordOwnWrites(path.dirname(dir), () => decidePending(dir, {
    slugs: name ? [name] : [], all: Boolean(args.all), reject: args.action === 'reject',
  }));
  if (r.missing.length) {
    printErr(`[memory] nothing waits under ${r.missing.join(', ')}.\n`);
    return 1;
  }
  if (r.backup) printOut(`[memory] the store was copied to ${r.backup} first\n`);
  if (r.stale.length) printOut(`[memory] dropped ${r.stale.length} stale action(s), their fact changed since: ${r.stale.join(', ')}\n`);
  const done = args.action === 'reject' ? r.rejected : r.applied;
  printOut(`[memory] ${args.action === 'reject' ? 'rejected' : 'applied'} ${done.length} action(s)${done.length ? `: ${done.join(', ')}` : ''}\n`);
  return 0;
}
