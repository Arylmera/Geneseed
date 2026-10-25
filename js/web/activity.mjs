/**
 * The live-activity surface. A GET reads; it never deletes or moves a file.
 *
 * It reads the per-session JSON files two writers put into `<cfg>/activity/`: the
 * `geneseed-activity` OpenCode plugin, and the hook-side writer for Claude Code, OpenClaude
 * and Bob (`js/hosts/activity.mjs`). Writers and reader share only that directory: no RPC,
 * crash-isolated, and cross-tool by construction. A live session is in `activity`; a stale,
 * dead or ended one — in the directory still, or already swept into `activity/archive/` — is
 * in `ended`, marked `ended: true`, and the live copy wins a duplicate.
 *
 * WHY THE GET STOPPED PRUNING. It used to unlink every snapshot that failed the liveness test,
 * which made a page view the one web read that deleted, and left nothing to show of a session
 * that had just finished. Moving belongs to `sweepActivity`, which the hook writer runs on
 * SessionStart and SessionEnd and which archives instead of deleting. The OpenCode plugin never
 * sweeps, so its dead snapshots stay in place: `ended` is therefore capped HERE, in what is
 * returned, to the archive's own rule (the newest `ARCHIVE_KEEP`, none older than
 * `ARCHIVE_MAX_AGE_SECONDS`) — without touching a file.
 *
 * `/api/activity` answers a GET through `apiActivity` and a POST through `apiActivityToggle`
 * at the bottom of this file. It is the one POST route whose result is sent at 200 whatever
 * `ok` says, which is why `POST_ROUTES` in `js/web/routes.mjs` carries a 409 COLUMN rather
 * than a rule — and giving this row the 409 treatment is mutation M22.
 *
 * Liveness (`isLive`) is owned by `js/hosts/activity.mjs`, because the sweep needs the same
 * answer: a hook snapshot carries `pid: null` and is live by staleness alone; a plugin one is
 * also probed with `process.kill(pid, 0)`, which is a core `process` API, not `child_process`.
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
import { mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { readText, writeText, isDir, isFile } from '../lib/fs.mjs';
import { parseJson, isTruthy } from '../lib/json.mjs';
import { normcase } from '../lib/paths.mjs';
import { stripWhitespace } from '../lib/text.mjs';
import { ARCHIVE_KEEP, ARCHIVE_MAX_AGE_SECONDS, isLive, safeStem } from '../hosts/activity.mjs';
import { NotFound, stemOf } from './catalog.mjs';

const nowSeconds = () => Date.now() / 1000;

/**
 * `<target>/activity`. `state.target` is ALREADY the viewed install's config dir (OpenCode's, or
 * a Claude-shaped host's), so this must not append `opencode/` again; that double-join is the
 * classic seam bug.
 */
const activityDir = (state) => path.join(state.target, 'activity');

/** The runtime on/off flag — the same path the plugin resolves. */
const activityFlag = (state) => path.join(state.target, '.geneseed-activity');

/**
 * On unless the flag file explicitly says off. An absent (or unreadable) file is the
 * default every user who has never toggled is in. An undecodable flag file is not treated
 * specially: Node substitutes U+FFFD and reads on rather than raising.
 */
function activityEnabled(state) {
  let raw;
  try {
    raw = readText(activityFlag(state));
  } catch {
    return true;
  }
  return !['off', '0', 'false', 'no'].includes(stripWhitespace(raw).toLowerCase());
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

/**
 * `[name, entry]` for every snapshot that parses in `d`, sorted by name. Never throws: a
 * missing dir is `[]`, and a garbage file is skipped and left where it is.
 */
function snapshots(d) {
  if (!isDir(d)) return [];
  let names;
  try {
    names = readdirSync(d);
  } catch {
    return [];
  }
  // Case-INSENSITIVE for the `.json` suffix (matches Windows filesystem behaviour); the
  // `.detail.json` check below is case-SENSITIVE on both platforms. Two different rules,
  // deliberately.
  return names.filter((n) => normcase(n).endsWith('.json') && !n.endsWith('.detail.json')).sort()
    .map((name) => [name, readEntry(path.join(d, name))]).filter(([, e]) => e !== null);
}

// STABLE sort matters when `updated_at` ties: a `b - a` comparator over ES2019's
// guaranteed-stable `Array.sort` preserves the original (directory-listing) order for equal keys.
const newestFirst = (list) => list.sort((a, b) => Number(b.updated_at) - Number(a.updated_at));

/**
 * `{activity, ended}`: the live sessions, and the ones that are not — still in the directory
 * or already archived — each listed once, the live copy and then the directory's winning.
 */
function activityEntries(state) {
  const d = activityDir(state);
  const now = nowSeconds();
  const live = [];
  const ended = [];
  const seen = new Set();
  const rest = [];
  for (const [name, entry] of snapshots(d)) {
    const e = normalizeEntry(entry, stemOf(name));
    if (isLive(entry, now)) { live.push(e); seen.add(String(e.session_id)); } else rest.push(e);
  }
  for (const [name, entry] of snapshots(path.join(d, 'archive'))) {
    rest.push(normalizeEntry(entry, stemOf(name)));
  }
  for (const e of rest) {
    if (seen.has(String(e.session_id))) continue;
    seen.add(String(e.session_id));
    if (now - Number(e.updated_at) > ARCHIVE_MAX_AGE_SECONDS) continue;
    ended.push({ ...e, ended: true });
  }
  return { activity: newestFirst(live), ended: newestFirst(ended).slice(0, ARCHIVE_KEEP) };
}

export function apiActivity(state) {
  const enabled = activityEnabled(state);
  return { enabled, ...(enabled ? activityEntries(state) : { activity: [], ended: [] }) };
}

/**
 * One session's snapshot plus its step timeline and its UNCAPPED files/todos. A session that is
 * no longer live — still in the directory, or archived — is returned too, with `ended: true`.
 * 404 only if neither holds it; a missing or garbage detail file degrades to an empty timeline
 * rather than a 500.
 */
export function apiActivityDetail(state, sid) {
  // Resolve by the writer's safe-name scheme (`safeStem`), which is also what keeps the read
  // inside the directory: every separator, `..` and drive colon becomes `_`, so there is no
  // join to steer.
  const stem = safeStem(sid);
  let d = activityDir(state);
  let entry = isFile(path.join(d, `${stem}.json`)) ? readEntry(path.join(d, `${stem}.json`)) : null;
  if (entry === null) {
    d = path.join(d, 'archive');
    entry = isFile(path.join(d, `${stem}.json`)) ? readEntry(path.join(d, `${stem}.json`)) : null;
  }
  if (entry === null) throw new NotFound(sid);
  const session = normalizeEntry(entry, stem);
  if (!isLive(entry, nowSeconds())) session.ended = true;
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
