/**
 * The loop registry — `<userLoopsDir()>/loops.json` — the list of worktrees `geneseed loop init`
 * has launched a loop in. `LOOP.md` stays the only source of loop STATE; this file stores
 * identity only (root, branch, title, started, initAt, finishedAt, and `factory` for a loop that
 * is a factory stage), so the Active tab can discover
 * a loop without scanning every worktree on the machine.
 *
 * WRITER CONVENTIONS, mirrored from `js/inspect/registry.mjs` (`installs.json`'s own registry)
 * on purpose rather than invented fresh: `jsonDumpsIndent` because these rows are absolute
 * paths and a username carrying an accent writes one here (ensure_ascii matters); a
 * `<file>.tmp` + `renameWithRetry` (LOOP.md's own atomic rename, retried on a transient Windows
 * lock) so a crash mid-write cannot leave `loops.json` half-written where
 * the NEXT read would see valid-but-truncated JSON instead of either the old file or the new
 * one; and every public function swallows its own errors — a registry hiccup must never fail
 * `loop init`, and a corrupt `loops.json` must read back as empty rather than throw. The one
 * difference from `installs.json`: this file keys rows by object (`{root, branch, title,
 * started, finishedAt}`), not by a bare path, because identity alone is not enough to render a
 * card.
 *
 * NO `lastSeen`. The Active tab POLLS `activeLoops` on an interval, and a field refreshed on
 * every read would make every poll a write — fine for `installs.json` (`record` fires once per
 * emit), wrong here (the page's own `usePoll` fires every few seconds, for as long as the tab
 * is open, on a machine that may be a laptop on battery). So `activeLoops` saves the registry
 * back ONLY when the kept set actually differs from what it loaded — a root pruned, a loop
 * newly seen finished, or a loop seen running again after having been finished — never merely
 * to record that a poll happened. `finishedAt` replaces `lastSeen` for the one thing a
 * timestamp was doing here: it is set ONCE, the first time a row is found WITHOUT a LOOP.md
 * (the loop finished), and the 7-day prune window counts from there — not from a last-poll time
 * nothing refreshes any more. A loop seen running again afterwards (the same worktree
 * re-`init`ed) clears it, so a stale finished-window never survives into a loop that is running
 * again.
 *
 * `recordLoop` and `setLoopPreset` resolve the root they are given the same way — `normalize`:
 * `realpathSync.native`, falling back to `path.resolve` for a root that no longer exists — and
 * compare it with `normcase`, the same case-folding `js/lib/paths.mjs` uses everywhere a Windows
 * path is compared, so a loop launched from a differently-cased spelling of the same worktree is
 * still one row, not two. `activeLoops` compares nothing: it reads each row's root as stored.
 */
import { readFileSync, mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { userLoopsDir } from './catalog.mjs';
import { writeText, readText, isDir, isFile } from '../lib/fs.mjs';
import { parseJson, jsonDumpsIndent } from '../lib/json.mjs';
import { normcase } from '../lib/paths.mjs';
import { parseLoopFile, writeLoopFile, renameWithRetry, reviewOf, LOOP_FILE } from './state.mjs';
import { PRESETS } from './score.mjs';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function registryPath() {
  return path.join(userLoopsDir(), 'loops.json');
}

/**
 * The rows under `key` in the registry `file`, `[]` when it is missing or corrupt. Exported with
 * `saveRows`, `normalize`, `sameRoot` and `sweepRows` for `js/factory/registry.mjs`: its
 * `factories.json` follows every convention of this file, so the two share the code, not a copy.
 */
export function loadRows(file, key) {
  try {
    const data = parseJson(readFileSync(file, 'utf8'));
    return Array.isArray(data?.[key]) ? data[key].filter((l) => l && typeof l.root === 'string') : [];
  } catch {
    return [];
  }
}

export function saveRows(file, key, rows) {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeText(tmp, `${jsonDumpsIndent({ [key]: rows })}\n`);
    renameWithRetry(tmp, file);
  } catch {
    /* best-effort: a registry hiccup must never fail init or a read */
  }
}

const load = () => loadRows(registryPath(), 'loops');
const save = (loops) => saveRows(registryPath(), 'loops', loops);

export function normalize(dir) {
  try { return realpathSync.native(dir); } catch { return path.resolve(dir); }
}

export const sameRoot = (a, b) => normcase(a) === normcase(b);

function runningRow(entry, state) {
  return {
    root: entry.root, branch: entry.branch, title: entry.title, started: entry.started,
    status: state.status, iteration: state.iteration, node: state.node, preset: state.preset,
    threshold: PRESETS[state.preset], current: state.current, history: state.history,
    review: reviewOf(state), reason: state.reason, awaiting: state.awaiting, graph: state.graph,
  };
}

/**
 * Upsert `root`'s identity row. Called by `geneseed loop init` right after `LOOP.md` is
 * written — `started` is set once, on insert, and never moved by a later call. `initAt` is set on
 * EVERY call: `init` refuses while a LOOP.md exists, so each call starts a fresh loop, and
 * `initAt` is the time of the latest one (`loopInitAt`, the factory's R2 evidence). An update never
 * touches `finishedAt` either way: `activeLoops` is the only writer of that field, and it will
 * clear it on the very next poll once it sees LOOP.md present again. Never throws: an `init`
 * must succeed even when the registry itself cannot be written.
 */
export function recordLoop({ root, branch, title, factory = null, now = new Date() }) {
  try {
    const key = normalize(root);
    const loops = load();
    const idx = loops.findIndex((l) => sameRoot(l.root, key));
    const initAt = now.toISOString();
    const row = idx >= 0
      ? { ...loops[idx], root: key, branch, title, initAt }
      : { root: key, branch, title, started: initAt, initAt };
    // The factory run this loop is a stage of (`loop init --factory <slug>`). A later plain
    // `loop init` in the same worktree is a stage of no run, so the field drops.
    if (factory) row.factory = factory; else delete row.factory;
    if (idx >= 0) loops[idx] = row; else loops.push(row);
    save(loops);
  } catch {
    /* a registry hiccup must never fail loop init */
  }
}

/**
 * The `initAt` of `root`'s row, or null (no row, a row from before the field, an unreadable
 * registry). READ-ONLY, unlike `activeLoops`: `geneseed factory record` calls it, and a record
 * must not prune or stamp rows.
 */
export function loopInitAt(root) {
  const key = normalize(root);
  const row = load().find((l) => sameRoot(l.root, key));
  return typeof row?.initAt === 'string' ? row.initAt : null;
}

/**
 * The rows the Active tab renders, read fresh off every registered worktree's `LOOP.md` —
 * never off the registry's own stale copy of a loop's state. Four outcomes per row; the
 * write-back at the end fires ONLY when one of the first three actually changed something
 * (see the module docblock on why a routine poll must not be a write):
 *   - the worktree root no longer exists: dropped, silently (a removed clone or worktree);
 *   - `<root>/LOOP.md` exists but fails to parse (corrupt, or written mid-crash before this
 *     module's own atomic writer existed): the entry is KEPT exactly as read — dropping it here
 *     would be indistinguishable from a removed worktree, and a card the user can still see
 *     beats one that silently vanishes — and the row reports `status: 'unreadable'`;
 *   - `<root>/LOOP.md` exists and parses: the row carries the state fields the page needs, and
 *     if the entry still carried a `finishedAt` from a previous finish it is cleared (the loop
 *     is running again — that counts as a change, and is saved);
 *   - `LOOP.md` is gone (the loop finished): the first time this is seen, `finishedAt` is set
 *     to `now` and saved; after that it is read-only here until `now` is more than 7 days past
 *     that frozen `finishedAt`, at which point the row is dropped (and the drop is saved).
 */
export function activeLoops({ now = new Date() } = {}) {
  const { kept, rows, changed } = sweepRows(load(), {
    stateFile: LOOP_FILE, parse: parseLoopFile, project: runningRow, now,
    identity: (e) => ({ root: e.root, branch: e.branch, title: e.title, started: e.started }),
  });
  if (changed) save(kept);
  return rows;
}

/**
 * `activeLoops`' four outcomes, over any registry whose rows name a state file at their root:
 * `parse` reads that file, `project(entry, state)` builds a running row, `identity(entry)` the row
 * of an unreadable or finished one. Returns the rows, the entries to keep, and whether keeping
 * them differs from what was loaded — the only case in which the caller saves.
 */
export function sweepRows(entries, { stateFile, parse, project, identity, now }) {
  const kept = [];
  const rows = [];
  let changed = false;
  for (const entry of entries) {
    if (!isDir(entry.root)) { changed = true; continue; }
    const file = path.join(entry.root, stateFile);
    const id = identity(entry);
    if (isFile(file)) {
      let state;
      try { state = parse(readText(file)); } catch {
        kept.push(entry);
        rows.push({ ...id, status: 'unreadable' });
        continue;
      }
      let next = entry;
      if (entry.finishedAt !== undefined) {
        next = { ...entry }; delete next.finishedAt; changed = true;
      }
      kept.push(next);
      rows.push(project(next, state));
      continue;
    }
    if (entry.finishedAt === undefined) {
      const next = { ...entry, finishedAt: now.toISOString() };
      changed = true;
      kept.push(next);
      rows.push({ ...id, status: 'finished' });
      continue;
    }
    const age = now.getTime() - new Date(entry.finishedAt).getTime();
    if (age > SEVEN_DAYS_MS) { changed = true; continue; }
    kept.push(entry);
    rows.push({ ...id, status: 'finished' });
  }
  return { kept, rows, changed };
}

/**
 * The running rows only, READ-ONLY: the same `runningRow` projection as `activeLoops`, for every
 * registered root whose `LOOP.md` exists and parses, and never a save. The Activity page polls
 * every 2 s and only needs to know which loops run; letting that poll prune or stamp
 * `finishedAt` would race `recordLoop` on the one `loops.json.tmp`. Finished, unreadable and
 * vanished rows are simply absent; `activeLoops` stays their only writer.
 */
export function runningLoops() {
  const rows = [];
  for (const entry of load()) {
    const file = path.join(entry.root, LOOP_FILE);
    if (!isFile(file)) continue;
    try { rows.push(runningRow(entry, parseLoopFile(readText(file)))); } catch { /* unreadable */ }
  }
  return rows;
}

/**
 * Rewrite `root`'s `LOOP.md` `preset` field and nothing else — the per-loop preset picker on
 * the Active tab. Refuses a `root` the registry does not know about (no arbitrary path
 * writes — `POST /api/loops/preset`'s whole safety argument) and a `preset` outside `PRESETS`,
 * each with its own message so the web action can tell the two refusals apart. Unlike
 * `recordLoop`/`activeLoops`, this one DOES throw: a preset change the caller asked for and did
 * not happen must be reported, not swallowed. Writes through `writeLoopFile` (atomic, like
 * every other LOOP.md persist — see `state.mjs`'s docblock).
 */
export function setLoopPreset(root, preset) {
  if (!Object.hasOwn(PRESETS, preset)) throw new Error(`unknown preset ${JSON.stringify(preset)}`);
  const key = normalize(root);
  const loops = load();
  const entry = loops.find((l) => sameRoot(l.root, key));
  if (!entry || !isDir(entry.root)) throw new Error('unknown loop');
  const file = path.join(entry.root, LOOP_FILE);
  if (!isFile(file)) throw new Error('unknown loop');
  const state = parseLoopFile(readText(file));
  state.preset = preset;
  writeLoopFile(file, state);
  return runningRow(entry, state);
}
