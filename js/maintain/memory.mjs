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
 *   * THE RESERVED-NAME CHECK IS CASE-INSENSITIVE, WHICH THE ENDPOINT'S IS NOT. It compares
 *     `MEMORY` and `README` exactly. On a case-insensitive filesystem — which is every
 *     Windows install and the default macOS one — `rm memory` then resolves to the index
 *     file, passes the guard, and deletes the thing the agent reads at session start. This
 *     is a NARROWING of what the endpoint accepts, on a destructive path, and it is the one
 *     divergence in this file that is not about resolution.
 *
 * `memoryDropIndex` is the hook module's, not a copy: writing the fact and unwriting its
 * index line are two halves of one format, and the half that writes lives there.
 */
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import { memoryDropIndex } from '../hosts/hooks.mjs';
import { resolveMemoryDir } from '../hosts/hosts.mjs';
import { pyPrint, pyPrintErr } from '../lib/fs.mjs';

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

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

/** `api_memory_delete`, minus the HTTP: the file, then its line in the index. */
export function memoryDelete(dir, name) {
  if (!isFactName(name)) return false;
  const p = path.join(dir, `${name}.md`);
  if (!isFile(p)) return false;
  unlinkSync(p);
  memoryDropIndex(dir, name);
  return true;
}

/** The verb. */
export function cmdMemory(args) {
  const dir = resolveMemoryDir(args.memory);
  if (dir === null) {
    // The resolver answers null for "no store anywhere on the chain", which is also what an
    // explicit `--memory` that is not a directory gives — so the message names both.
    pyPrintErr('[memory] no memory store found. Pass --memory <dir>, set $GENESEED_MEMORY, '
      + 'or run this from a directory with a memory/ store.\n');
    return 1;
  }
  if (args.action === 'list') {
    const facts = memoryFacts(dir);
    if (!facts.length) {
      pyPrint(`[memory] ${dir}: no facts.\n`);
      return 0;
    }
    pyPrint(`[memory] ${dir}\n`);
    for (const name of facts) pyPrint(`  ${name}\n`);
    return 0;
  }
  if (!args.name) {
    pyPrintErr('[memory] rm needs the name of a fact.\n');
    return 2;
  }
  if (!memoryDelete(dir, args.name)) {
    // ONE MESSAGE FOR BOTH REFUSALS, which is the endpoint's shape too — it raises the same
    // `NotFound(name)` for a reserved name, a name with a separator and a fact that is not
    // there. Telling a caller that `MEMORY` exists but is protected is a distinction this
    // verb has no reason to draw.
    pyPrintErr(`[memory] no such fact '${args.name}' in ${dir}.\n`);
    return 1;
  }
  pyPrint(`[memory] deleted ${args.name}.\n`);
  return 0;
}
