/**
 * The live-activity surface — the one web endpoint that
 * DELETES.
 *
 * It reads the per-session JSON files the `geneseed-activity` OpenCode plugin writes into
 * `<opencode-cfg>/activity/`, prunes the dead and the stale ones (unlinking them, so the
 * directory self-cleans), and returns what is left. Writer and reader share only that
 * directory: no RPC, crash-isolated, and cross-tool by construction.
 *
 * `/api/activity` answers a GET through `apiActivity` and a POST through `apiActivityToggle`
 * at the bottom of this file. It is the one POST route whose result is sent at 200 whatever
 * `ok` says, which is why `POST_ROUTES` in `js/web/routes.mjs` carries a 409 COLUMN rather
 * than a rule — and giving this row the 409 treatment is mutation M22.
 *
 * `process.kill(pid, 0)` PROBES LIVENESS WITHOUT A SPAWN — it is a core `process` API, not
 * `child_process`, so it stays clear of the spawn ban. libuv's `uv_kill` opens the process
 * for query and answers `ESRCH` when the pid is free and `EPERM` when it cannot tell —
 * "no such process" vs "err toward alive".
 *
 * `process.kill` alone cannot tell a truly-dead pid from one that EXITED but whose handle is
 * still held: it reports the latter alive too. The staleness backstop (below) is what prunes
 * it, thirty minutes later — reproducing an exit-code read would need a native binding, not
 * worth it for a best-effort probe that already errs toward "alive" on any inconclusive
 * answer.
 *
 * `parseJson`, NOT `JSON.parse` — NOT a style choice. These files are written by a third
 * party and carry `cost` as a float. `JSON.parse` collapses `1.0` to the bare integer `1`,
 * which `bareInts` then renders back as `1`, losing the distinction the source file made;
 * `parseJson`'s wrapper is what survives the round trip.
 *
 * Its companion is `isTruthy`: a naive `entry.cost || 0` fallback is TRUE for a wrapped zero
 * (the wrapper is an object, never falsy on its own), which would echo back the wrapper's
 * `0.0` instead of collapsing to the fallback `0`. `isTruthy` is what makes a wrapped zero
 * read as falsy, so a `"cost": 0.0` entry correctly comes back `0`.
 */
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import { readText, writeText, isDir, isFile } from '../lib/fs.mjs';
import { parseJson, isTruthy } from '../lib/json.mjs';
import { normcase } from '../lib/paths.mjs';
import { parseIntStrict, stripWhitespace } from '../lib/text.mjs';
import { NotFound, stemOf } from './api.mjs';

/**
 * A session whose writer is gone, or that has not been touched in this long, is pruned.
 * pid-liveness is the real signal; the staleness backstop covers a reused pid and a
 * platform where the probe cannot tell. Generous on purpose: streaming bumps `updated_at`
 * constantly, so only a genuinely abandoned (process-still-alive) session ages out.
 */
export const ACTIVITY_STALE_SECONDS = 1800;

const nowSeconds = () => Date.now() / 1000;

/**
 * `<target>/activity`. `state.target` is ALREADY the OpenCode config dir, so this must not
 * append `opencode/` again; that double-join is the classic seam bug.
 */
const activityDir = (state) => path.join(state.target, 'activity');

/** The runtime on/off flag — the same path the plugin resolves. */
const activityFlag = (state) => path.join(state.target, '.geneseed-activity');

/**
 * On unless the flag file explicitly says off. An absent (or unreadable) file is the
 * default every user who has never toggled is in. An undecodable flag file is not treated
 * specially: Node substitutes U+FFFD and reads on rather than raising.
 */
export function activityEnabled(state) {
  let raw;
  try {
    raw = readText(activityFlag(state));
  } catch {
    return true;
  }
  return !['off', '0', 'false', 'no'].includes(stripWhitespace(raw).toLowerCase());
}

/**
 * Coerces a raw pid value to an integer, or `null` for anything unusable.
 *
 * The value came out of `parseJson`, so a JSON number may arrive wrapped in `JsonNumber`,
 * which this module cannot import by name (only `parseJson`/`isTruthy`/etc are exported). It
 * is recognised by the only thing the wrapper promises: a numeric `valueOf`. A plain
 * object's `valueOf` returns itself (rejected by the `typeof n !== 'number'` check below)
 * and an array is excluded outright. Also handles a decimal string, a boolean (`true` → 1),
 * and a float (truncated) — whatever a hand-edited snapshot can produce.
 */
function toIntOr(raw) {
  if (raw === true) return 1;
  if (raw === false) return 0;
  if (typeof raw === 'string') return parseIntStrict(stripWhitespace(raw));
  const n = (raw !== null && typeof raw === 'object' && !Array.isArray(raw))
    ? raw.valueOf() : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/** Best-effort liveness for the writer process. See this file's header. */
export function pidAlive(raw) {
  const pid = toIntOr(raw);
  if (pid === null || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // ESRCH → dead. Anything else (`EPERM`, and whatever a locked-down host answers) →
    // alive, and the staleness backstop decides.
    return !(e && e.code === 'ESRCH');
  }
}

/**
 * One session snapshot normalised into the stable shape the UI consumes. v1 writers omit
 * the enrichment keys, so those default to null/0 and the UI hides what is absent. The KEY
 * ORDER here is deliberate and stable — do not reshuffle it.
 */
function normalizeEntry(entry, stem) {
  const g = (k) => (Object.hasOwn(entry, k) ? entry[k] : null);
  const or = (k, dflt) => (isTruthy(g(k)) ? g(k) : dflt);
  return {
    session_id: or('session_id', stem),
    agent: g('agent'),
    title: g('title'),
    cwd: g('cwd'),
    status: or('status', 'idle'),
    updated_at: or('updated_at', 0),
    model: g('model'),
    phase: g('phase'),
    turn_started_at: g('turn_started_at'),
    cost: or('cost', 0),
    tokens: or('tokens', 0),
    files: g('files'),
    todos: g('todos'),
    blocked_on: g('blocked_on'),
    error: g('error'),
  };
}

/** `null` on a missing, garbage or non-dict file. Never throws. */
function readEntry(p) {
  let entry;
  try {
    entry = parseJson(readText(p));
  } catch {
    return null;
  }
  return (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) ? entry : null;
}

/** The writer's pid is alive AND the snapshot is not stale. */
function isLive(entry, now) {
  const updated = isTruthy(Object.hasOwn(entry, 'updated_at') ? entry.updated_at : null)
    ? entry.updated_at : 0;
  return (now - Number(updated)) <= ACTIVITY_STALE_SECONDS && pidAlive(
    Object.hasOwn(entry, 'pid') ? entry.pid : null);
}

/**
 * Every live session, dead and stale ones pruned AND their files removed. Never throws: a
 * missing dir is `[]`, a garbage file is skipped (and kept — only a snapshot that PARSED and
 * failed the liveness test is unlinked), newest first.
 */
export function activityEntries(state) {
  const d = activityDir(state);
  if (!isDir(d)) return [];
  const now = nowSeconds();
  const out = [];
  let names;
  try {
    names = readdirSync(d);
  } catch {
    return [];
  }
  // Case-INSENSITIVE for the `.json` suffix (matches Windows filesystem behaviour); the
  // `.detail.json` check below is case-SENSITIVE on both platforms. Two different rules,
  // deliberately.
  for (const name of names.filter((n) => normcase(n).endsWith('.json')).sort()) {
    if (name.endsWith('.detail.json')) continue;
    const p = path.join(d, name);
    const entry = readEntry(p);
    if (entry === null) continue;
    if (!isLive(entry, now)) {
      try {
        unlinkSync(p);                                          // crashed / abandoned writer
        unlinkSync(path.join(d, `${stemOf(name)}.detail.json`));   // its detail file too
      } catch { /* both unlinks are best-effort; a lingering file next scan is harmless */ }
      continue;
    }
    out.push(normalizeEntry(entry, stemOf(name)));
  }
  // STABLE sort matters when `updated_at` ties: a `b - a` comparator over ES2019's
  // guaranteed-stable `Array.sort` preserves the original (directory-listing) order for
  // equal keys.
  out.sort((a, b) => Number(b.updated_at) - Number(a.updated_at));
  return out;
}

export function apiActivity(state) {
  const enabled = activityEnabled(state);
  return { enabled, activity: enabled ? activityEntries(state) : [] };
}

/**
 * One session's snapshot plus its step timeline and its UNCAPPED files/todos. 404 if the
 * session is absent or has aged out; a missing or garbage detail file degrades to an empty
 * timeline rather than a 500.
 */
export function apiActivityDetail(state, sid) {
  const d = activityDir(state);
  // Resolve by the writer's safe-name scheme, which is also what keeps the read inside the
  // directory: every separator, `..` and drive colon becomes `_`, so there is no join to
  // steer. The `u` flag makes an astral character ONE replacement rather than one per
  // surrogate half.
  const stem = sid.replace(/[^A-Za-z0-9_.-]/gu, '_');
  const snap = path.join(d, `${stem}.json`);
  const entry = isFile(snap) ? readEntry(snap) : null;
  if (entry === null || !isLive(entry, nowSeconds())) throw new NotFound(sid);
  const session = normalizeEntry(entry, stem);
  let timeline = [];
  let full = {};
  const det = readEntry(path.join(d, `${stem}.detail.json`));
  if (isTruthy(det)) {
    const tl = Object.hasOwn(det, 'timeline') ? det.timeline : null;
    timeline = Array.isArray(tl) ? tl : [];
    full = det;
  }
  const fg = (k) => (Object.hasOwn(full, k) ? full[k] : null);
  // The detail file carries the uncapped lists; fall back to the snapshot's capped ones.
  session.files = isTruthy(fg('files')) ? fg('files') : session.files;
  session.todos = isTruthy(fg('todos')) ? fg('todos') : session.todos;
  // The compact transcript: an ordered list of {role, text, t} turns. Empty falls back to
  // the title as the opening user turn, because OpenCode derives the title from the first
  // prompt.
  const conv = fg('conversation');
  let conversation = Array.isArray(conv) ? conv : [];
  if (conversation.length === 0 && isTruthy(session.title)) {
    conversation = [{ role: 'user', text: session.title }];
  }
  return { session, timeline, conversation };
}

/**
 * Flip the runtime on/off flag.
 *
 * The OpenCode plugin reads this file on every event, so the change takes effect without
 * restarting anything; writing `off` also makes the plugin clear its snapshots on its next
 * event, while the reader gates the surface immediately.
 *
 * DEFAULTS TO ON: an empty or missing `enabled` field in the body enables. Do not read this
 * as `body.enabled === true` — that would flip an absent field to "disable" instead.
 *
 * This is the one POST route whose result is sent at 200 whatever `ok` says — see this
 * file's header, and `POST_ROUTES_CONVENTION` in `js/web/routes.mjs`.
 */
export function apiActivityToggle(state, body) {
  const raw = (body && Object.hasOwn(body, 'enabled')) ? body.enabled : true;
  const enabled = isTruthy(raw);
  const p = activityFlag(state);
  try {
    mkdirSync(path.dirname(p), { recursive: true });
    writeText(p, enabled ? 'on' : 'off');
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
  return { ok: true, enabled };
}
