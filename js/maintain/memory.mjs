/**
 * `geneseed memory` — the memory store from a terminal.
 *
 * WHY THIS VERB IS NEW RATHER THAN PORTED. The reference had no `memory` subcommand: a fact
 * could be written by the `learn` hook and deleted from the web console, and there was no
 * third way. So the semantics here are the DELETE ENDPOINT's, deliberately and field for
 * field — the same reserved names, the same "a bare slug, never a path" rule, the same
 * index line dropped from MEMORY.md after the file goes — because two ways to remove a fact
 * that disagree about what a fact is would be worse than one way.
 *
 * WHERE IT PARTS COMPANY WITH THE ENDPOINT, AND WHY. Two places, both forced by the
 * difference between a browser talking to a running server and a person typing in a shell:
 *
 *   * THE STORE IS RESOLVED, NOT CONFIGURED. The endpoint is always `<target>/memory`,
 *     because a server has a target. A CLI has a cwd, so this takes the resolver every other
 *     terminal-side reader of the store already uses — `$GENESEED_MEMORY`, then a store
 *     beside the cwd, then the global config dir — with `--memory` as the explicit override.
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
 */
import { readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import { archiveFact, memoryDropIndex } from '../hosts/memory-files.mjs';
import { resolveMemoryDir } from '../hosts/hosts.mjs';
import { printOut, printErr, isFile } from '../lib/fs.mjs';

/**
 * The two names the store owns rather than holds: the index the agent reads at session
 * start, and the file that documents the store. `api_memory_delete` refuses both.
 */
const RESERVED = ['memory', 'readme'];

/** Whether `name` is a fact this verb may act on — the endpoint's rule, plus the case fold. */
export function isFactName(name) {
  return Boolean(name) && !name.includes('/') && !name.includes('\\')
    && !RESERVED.includes(name.toLowerCase());
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
  let dest = '';
  if (purge) unlinkSync(p);
  else dest = archiveFact(dir, name);
  memoryDropIndex(dir, name);
  return dest;
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
    printErr('[memory] no memory store found. Pass --memory <dir>, set $GENESEED_MEMORY, '
      + 'or run this from a directory with a memory/ store.\n');
    return 1;
  }
  const where = args.archived ? path.join(dir, 'archive') : dir;
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
  printOut(done ? `[memory] archived ${args.name} -> ${done}\n` : `[memory] deleted ${args.name}.\n`);
  return 0;
}
