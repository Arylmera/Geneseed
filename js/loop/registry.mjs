/**
 * The loop registry — `<userLoopsDir()>/loops.json` — the list of worktrees `geneseed loop init`
 * has launched a loop in. `LOOP.md` stays the only source of loop STATE; this file stores
 * identity only (root, branch, title, started, lastSeen), so the Active tab can discover a loop
 * without scanning every worktree on the machine.
 *
 * WRITER CONVENTIONS, mirrored from `js/inspect/registry.mjs` (`installs.json`'s own registry)
 * on purpose rather than invented fresh: `jsonDumpsIndent` because these rows are absolute
 * paths and a username carrying an accent writes one here (ensure_ascii matters); a
 * `<file>.tmp` + `renameSync` so a crash mid-write cannot leave `loops.json` half-written where
 * the NEXT read would see valid-but-truncated JSON instead of either the old file or the new
 * one; and every public function swallows its own errors — a registry hiccup must never fail
 * `loop init`, and a corrupt `loops.json` must read back as empty rather than throw. The one
 * difference from `installs.json`: this file keys rows by object (`{root, branch, title,
 * started, lastSeen}`), not by a bare path, because identity alone is not enough to render a
 * card.
 *
 * `recordLoop` and `activeLoops`/`setLoopPreset` never call each other's normalisation by
 * accident: both resolve a root through `realpathSync.native` (falling back to `path.resolve`
 * for a root that no longer exists) and compare with `normcase` — the same case-folding
 * `js/lib/paths.mjs` uses everywhere a Windows path is compared — so a loop launched from a
 * differently-cased spelling of the same worktree is still one row, not two.
 */
import { readFileSync, mkdirSync, realpathSync, renameSync } from 'node:fs';
import path from 'node:path';

import { userLoopsDir } from './catalog.mjs';
import { writeText, readText, isDir, isFile } from '../lib/fs.mjs';
import { parseJson, jsonDumpsIndent } from '../lib/json.mjs';
import { normcase } from '../lib/paths.mjs';
import { parseLoopFile, renderLoopFile, LOOP_FILE } from './state.mjs';
import { PRESETS } from './score.mjs';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function registryPath() {
  return path.join(userLoopsDir(), 'loops.json');
}

function load() {
  try {
    const data = parseJson(readFileSync(registryPath(), 'utf8'));
    return Array.isArray(data?.loops) ? data.loops.filter((l) => l && typeof l.root === 'string') : [];
  } catch {
    return [];
  }
}

function save(loops) {
  try {
    const file = registryPath();
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeText(tmp, `${jsonDumpsIndent({ loops })}\n`);
    renameSync(tmp, file);
  } catch {
    /* best-effort: a registry hiccup must never fail init or a read */
  }
}

function normalize(dir) {
  try { return realpathSync.native(dir); } catch { return path.resolve(dir); }
}

const sameRoot = (a, b) => normcase(a) === normcase(b);

/** The soft-decision iterations of `state.history` — the same shape `state.mjs`'s own
 * end-of-run `summary()` reports, so a card and a finished-loop review read the same fields. */
function reviewOf(state) {
  return state.history.filter((h) => h.decision === 'soft').map((h) => ({ iteration: h.iteration, intent: h.intent }));
}

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
 * written — `started` is set once, on insert, and never moved by a later call; `lastSeen` is
 * refreshed on every call so a loop re-recorded (or re-launched into the same worktree after a
 * prior one finished) stays inside the 7-day finished window from the moment it is seen again.
 * Never throws: an `init` must succeed even when the registry itself cannot be written.
 */
export function recordLoop({ root, branch, title, now = new Date() }) {
  try {
    const key = normalize(root);
    const loops = load();
    const idx = loops.findIndex((l) => sameRoot(l.root, key));
    const iso = now.toISOString();
    if (idx >= 0) {
      loops[idx] = { ...loops[idx], root: key, branch, title, lastSeen: iso };
    } else {
      loops.push({ root: key, branch, title, started: iso, lastSeen: iso });
    }
    save(loops);
  } catch {
    /* a registry hiccup must never fail loop init */
  }
}

/**
 * The rows the Active tab renders, read fresh off every registered worktree's `LOOP.md` —
 * never off the registry's own stale copy of a loop's state. Three outcomes per row, and the
 * write-back at the end makes each one durable:
 *   - the worktree root no longer exists: dropped, silently (a removed clone or worktree);
 *   - `<root>/LOOP.md` exists: parsed, `lastSeen` refreshed to `now` (the loop was just SEEN
 *     running), and the row carries the state fields the page needs;
 *   - `LOOP.md` is gone (the loop finished and its file was cleaned up, or never existed):
 *     `status: 'finished'`, kept — with `lastSeen` left exactly where it was, since nothing
 *     saw it run again — until `now` is more than 7 days past that frozen `lastSeen`.
 * A `LOOP.md` that fails to parse (corrupt, or missing its state block) is treated the same as
 * a missing root: dropped, rather than crashing the whole tab over one bad file.
 */
export function activeLoops({ now = new Date() } = {}) {
  const loops = load();
  const kept = [];
  const rows = [];
  for (const entry of loops) {
    if (!isDir(entry.root)) continue;
    const file = path.join(entry.root, LOOP_FILE);
    if (isFile(file)) {
      let state;
      try { state = parseLoopFile(readText(file)); } catch { continue; }
      const next = { ...entry, lastSeen: now.toISOString() };
      kept.push(next);
      rows.push(runningRow(next, state));
      continue;
    }
    const age = now.getTime() - new Date(entry.lastSeen).getTime();
    if (!(age <= SEVEN_DAYS_MS)) continue;
    kept.push(entry);
    rows.push({ root: entry.root, branch: entry.branch, title: entry.title, started: entry.started, status: 'finished' });
  }
  save(kept);
  return rows;
}

/**
 * Rewrite `root`'s `LOOP.md` `preset` field and nothing else — the per-loop preset picker on
 * the Active tab. Refuses a `root` the registry does not know about (no arbitrary path
 * writes — `POST /api/loops/preset`'s whole safety argument) and a `preset` outside `PRESETS`,
 * each with its own message so the web action can tell the two refusals apart. Unlike
 * `recordLoop`/`activeLoops`, this one DOES throw: a preset change the caller asked for and did
 * not happen must be reported, not swallowed.
 */
export function setLoopPreset(root, preset) {
  if (!PRESETS[preset]) throw new Error(`unknown preset ${JSON.stringify(preset)}`);
  const key = normalize(root);
  const loops = load();
  const entry = loops.find((l) => sameRoot(l.root, key));
  if (!entry || !isDir(entry.root)) throw new Error('unknown loop');
  const file = path.join(entry.root, LOOP_FILE);
  if (!isFile(file)) throw new Error('unknown loop');
  const state = parseLoopFile(readText(file));
  state.preset = preset;
  writeText(file, renderLoopFile(state));
  return runningRow(entry, state);
}
