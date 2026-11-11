/**
 * The factory registry — `factories.json`, beside `loops.json` in `userLoopsDir()` — the list of
 * worktrees `geneseed factory init` has started a run in (J9). FACTORY.md stays the only source of
 * run STATE; this file stores identity only (root, branch, factory, title, started, finishedAt),
 * so the console can find a run without scanning every worktree on the machine.
 *
 * EVERY CONVENTION IS THE LOOP REGISTRY'S, and so is the code (`js/loop/registry.mjs`: `loadRows`,
 * `saveRows`, `sweepRows`): atomic tmp + rename, every function swallows its own errors, rows keyed
 * by their normalised root, no `lastSeen`, and a finished run dropped 7 days after it was first
 * seen without its FACTORY.md.
 *
 * THE CONSOLE'S POLL NEVER WRITES (spec 2026-11-11 D7). The board polls every 5 s; a sweep there
 * would stamp `finishedAt`, drop rows, and race `recordFactory` on the one `factories.json.tmp`
 * during a `factory init`. So `listFactories` is read-only, as `runningLoops` is beside
 * `activeLoops`, and the sweep (stamp, 7-day prune, drop of a vanished root) runs in
 * `recordFactory`, which writes the file anyway. A finished run is first stamped by the next
 * `factory init` on the machine, so it is pruned 7 days after that, not after it closed.
 *
 * THE ROOT IS THE JOIN KEY. A child loop runs in the factory's own worktree, so its `loops.json`
 * row has the same root, and carries `factory: <slug>` (`loop init --factory`). A reader groups a
 * loop under its run by root; the slug is a label, never parsed back into a path.
 */
import path from 'node:path';

import { readText, isDir, isFile } from '../lib/fs.mjs';

import { userLoopsDir } from '../loop/catalog.mjs';
import { loadRows, saveRows, sweepRows, normalize, sameRoot } from '../loop/registry.mjs';
import { FACTORY_FILE, parseFactoryFile } from './state.mjs';
import { runMetrics } from './metrics.mjs';

export function factoryRegistryPath() {
  return path.join(userLoopsDir(), 'factories.json');
}

const load = () => loadRows(factoryRegistryPath(), 'factories');
const save = (rows) => saveRows(factoryRegistryPath(), 'factories', rows);

/**
 * Upsert `root`'s row, `factory` being the factory's name. `started` is set once, on insert; a
 * later init in the same worktree (a new run: `init` refuses while a FACTORY.md exists) updates
 * the rest. Never throws: an init must succeed even when the registry cannot be written.
 */
export function recordFactory({ root, branch, factory, title, now = new Date() }) {
  try {
    const key = normalize(root);
    const rows = sweep(load(), now).kept;   // the registry's one sweep: see the docblock
    const idx = rows.findIndex((r) => sameRoot(r.root, key));
    if (idx >= 0) rows[idx] = { ...rows[idx], root: key, branch, factory, title };
    else rows.push({ root: key, branch, factory, title, started: now.toISOString() });
    save(rows);
  } catch {
    /* a registry hiccup must never fail factory init */
  }
}

const identity = (e) => ({ root: e.root, branch: e.branch, factory: e.factory, title: e.title, started: e.started });

function runningRow(entry, state) {
  return {
    ...identity(entry), status: state.status, stage: state.stage, awaiting: state.awaiting,
    reason: state.reason, transitions: state.transitions, counters: state.counters,
    lane: state.lane ?? null, tasks: state.tasks, history: state.history,
    // The graph the run was started from, as the loop row carries its `graph`: the console draws
    // it, and a run started in another project names a factory this install may not have.
    graph: state.factory,
    // D7: the board's numbers, from the one function `factory report` prints (it never throws on
    // a state that parsed, and nothing here validated this one).
    metrics: runMetrics(state),
  };
}

const sweep = (rows, now) => sweepRows(rows, {
  stateFile: FACTORY_FILE, parse: parseFactoryFile, project: runningRow, identity, now,
});

/**
 * `listFactories`' rows, after the sweep: a vanished root is dropped, a finished run is stamped
 * and dropped 7 days later, and the file is saved when that changed anything. Not the console's
 * read; kept as the sweep's entry point for a caller that means to tidy the registry.
 */
export function activeFactories({ now = new Date() } = {}) {
  const { kept, rows, changed } = sweep(load(), now);
  if (changed) save(kept);
  return rows;
}

/**
 * The rows the console renders, READ-ONLY: never a save, a stamp or a prune. A running row read
 * fresh off each registered worktree's FACTORY.md, `unreadable` when it does not parse, and
 * `finished` when it is gone. A row whose root no longer exists is skipped: the sweep in
 * `recordFactory` drops it, and a card for a deleted worktree would open on nothing.
 */
export function listFactories() {
  const rows = [];
  for (const entry of load()) {
    if (!isDir(entry.root)) continue;
    const file = path.join(entry.root, FACTORY_FILE);
    if (!isFile(file)) { rows.push({ ...identity(entry), status: 'finished' }); continue; }
    let state;
    try { state = parseFactoryFile(readText(file)); } catch { rows.push({ ...identity(entry), status: 'unreadable' }); continue; }
    rows.push(runningRow(entry, state));
  }
  return rows;
}
