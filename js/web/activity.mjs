/**
 * `rituals/_web_activity.py` — the live-activity surface, and the first web endpoint that
 * DELETES.
 *
 * It reads the per-session JSON files the `geneseed-activity` OpenCode plugin writes into
 * `<opencode-cfg>/activity/`, prunes the dead and the stale ones (unlinking them, so the
 * directory self-cleans), and returns what is left. Writer and reader share only that
 * directory: no RPC, crash-isolated, and cross-tool by construction.
 *
 * ONLY THE GET HALF CROSSES IN P6e. `/api/activity` answers both verbs and
 * `api_activity_toggle` is a WRITE, so the path stays in `NOT_PORTED_POST` and the
 * partition test in `tests/test_web_server.py` keeps that honest. The consequence for the
 * gate is that the on/off flag can be READ but never flipped, which is why its two arms are
 * two cells rather than two requests in one.
 *
 * THE PLAN GUESSED `tasklist` AND THE SOURCE SAYS OTHERWISE. `_win_pid_alive` shells
 * nothing: it goes through `ctypes` to `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` and
 * `GetExitCodeProcess`. So there is no sixth `_ALLOWED_SPAWNS` row to argue — not because
 * the Node twin avoids a spawn, but because the REFERENCE never had one. `process.kill(pid,
 * 0)` is the twin here; it is a core `process` API and not `child_process`, so the ban that
 * P4a's source check enforces is untouched. libuv's `uv_kill` opens the process for query
 * and answers `ESRCH` when the pid is free and `EPERM` when it cannot tell, which is
 * exactly the reference's "no such process" / "err toward alive" pair.
 *
 * THE DIVERGENCE THAT LEAVES, DECLARED RATHER THAN HIDDEN. The reference also reads the
 * exit code and calls a process that has EXITED but whose handle is still held dead;
 * `process.kill` reports it alive, and the staleness backstop is what prunes it thirty
 * minutes later. Reproducing the exit-code read would mean a native binding, which this
 * port will not add for a best-effort liveness probe whose own docstring says any
 * inconclusive answer errs toward alive.
 *
 * `parseJson` AND NOT `JSON.parse`, WHICH IS NOT A STYLE CHOICE. These files are written by
 * a third party and carry `cost` — a float. Python's `json.loads` types `1.0` a float and
 * `json.dumps` writes it back `1.0`; `JSON.parse` gives a bare `1` that `bareInts` then
 * renders `1`. `parseJson`'s wrapper is the only thing that survives the round trip, and
 * `s-live`'s `"cost": 1.0` is the cell that says so. Its companion is `pyTruthy`: an
 * `entry.get("cost") or 0` over a wrapper object is TRUE for a wrapped zero, where Python's
 * `0.0 or 0` is the int `0` — so `s-older`'s `"cost": 0.0` must come back `0` and not `0.0`.
 */
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import {
  normcase, parseJson, pyInt, pyStripSpace, pyTruthy, readText, writeText,
} from '../lib/pyfs.mjs';
import { NotFound } from './api.mjs';

/**
 * `_web_activity.ACTIVITY_STALE_SECONDS` — a session whose writer is gone, or that has not
 * been touched in this long, is pruned. pid-liveness is the real signal; the staleness
 * backstop covers a reused pid and a platform where the probe cannot tell. Generous on
 * purpose: streaming bumps `updated_at` constantly, so only a genuinely abandoned
 * (process-still-alive) session ages out.
 */
export const ACTIVITY_STALE_SECONDS = 1800;

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

/** `time.time()` — unix seconds as a float. */
const nowSeconds = () => Date.now() / 1000;

/**
 * `_activity_dir` — `<target>/activity`. `state.target` is ALREADY the OpenCode config dir,
 * so this must not append `opencode/` again; that double-join is the classic seam bug.
 */
const activityDir = (state) => path.join(state.target, 'activity');

/** `_activity_flag` — the runtime on/off flag, the same path the plugin resolves. */
const activityFlag = (state) => path.join(state.target, '.geneseed-activity');

/**
 * `_activity_enabled` — on unless the flag file explicitly says off. An absent (or
 * unreadable) file is the default every user who has never toggled is in.
 *
 * The one input this cannot mirror is an undecodable flag file: Python's
 * `read_text(encoding="utf-8")` raises a `UnicodeDecodeError`, which is a `ValueError` and
 * not caught, where Node substitutes U+FFFD and reads on. No cell seeds one — it would take
 * a binary file where a four-letter word belongs — and the reference's answer there is a
 * 500, which is not a behaviour worth reproducing.
 */
export function activityEnabled(state) {
  let raw;
  try {
    raw = readText(activityFlag(state));
  } catch {
    return true;
  }
  return !['off', '0', 'false', 'no'].includes(pyStripSpace(raw).toLowerCase());
}

/**
 * `int(value)` as `_pid_alive` calls it — `TypeError` and `ValueError` both mean "not a
 * pid", so both come back null here.
 *
 * The value came out of `parseJson`, so a JSON number arrives inside a wrapper this module
 * cannot import by name. It is recognised by the only thing the wrapper promises, a numeric
 * `valueOf` — a plain object's returns itself and an array is excluded outright, which is
 * what `int({})` and `int([])` raising looks like from here. `int(1.9)` truncates and
 * `int(True)` is 1, both of which a hand-edited snapshot can produce.
 */
function pyIntOf(raw) {
  if (raw === true) return 1;
  if (raw === false) return 0;
  if (typeof raw === 'string') return pyInt(pyStripSpace(raw));
  const n = (raw !== null && typeof raw === 'object' && !Array.isArray(raw))
    ? raw.valueOf() : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/** `_pid_alive` — best-effort liveness for the writer process. See this file's header. */
export function pidAlive(raw) {
  const pid = pyIntOf(raw);
  if (pid === null || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // `ProcessLookupError` → dead. Anything else (`EPERM`, and whatever a locked-down host
    // answers) → alive, and the staleness backstop decides.
    return !(e && e.code === 'ESRCH');
  }
}

/**
 * `_normalize_entry` — one session snapshot into the stable shape the UI consumes. v1
 * writers omit the enrichment keys, so those default to null/0 and the UI hides what is
 * absent. The KEY ORDER is the reference's dict-literal order, which is what the byte
 * comparison over every response gates.
 */
function normalizeEntry(entry, stem) {
  const g = (k) => (Object.hasOwn(entry, k) ? entry[k] : null);
  const or = (k, dflt) => (pyTruthy(g(k)) ? g(k) : dflt);
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

/** `_read_entry` — null on a missing, garbage or non-dict file. Never throws. */
function readEntry(p) {
  let entry;
  try {
    entry = parseJson(readText(p));
  } catch {
    return null;
  }
  return (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) ? entry : null;
}

/** `_is_live` — the writer's pid is alive AND the snapshot is not stale. */
function isLive(entry, now) {
  const updated = pyTruthy(Object.hasOwn(entry, 'updated_at') ? entry.updated_at : null)
    ? entry.updated_at : 0;
  return (now - Number(updated)) <= ACTIVITY_STALE_SECONDS && pidAlive(
    Object.hasOwn(entry, 'pid') ? entry.pid : null);
}

/** `Path.stem` — the name without its LAST suffix, so `s-live.detail.json` keeps the dot. */
const stemOf = (name) => name.slice(0, name.length - path.extname(name).length);

/**
 * `_activity_entries` — every live session, dead and stale ones pruned AND their files
 * removed. Never throws: a missing dir is `[]`, a garbage file is skipped (and kept —
 * only a snapshot that PARSED and failed the liveness test is unlinked), newest first.
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
  // `Path.glob("*.json")` is case-INSENSITIVE on Windows, as pathlib's is; `str.endswith`
  // on the detail suffix is not, on either platform. Two different rules, deliberately.
  for (const name of names.filter((n) => normcase(n).endsWith('.json')).sort()) {
    if (name.endsWith('.detail.json')) continue;
    const p = path.join(d, name);
    const entry = readEntry(p);
    if (entry === null) continue;
    if (!isLive(entry, now)) {
      try {
        unlinkSync(p);                                          // crashed / abandoned writer
        unlinkSync(path.join(d, `${stemOf(name)}.detail.json`));   // its detail file too
      } catch { /* `contextlib.suppress(OSError)` wraps BOTH unlinks, as this does */ }
      continue;
    }
    out.push(normalizeEntry(entry, stemOf(name)));
  }
  // Stable in both languages, and the tie is the point: `sorted(reverse=True)` preserves the
  // original order of equal keys, and so does a `b - a` comparator over ES2019's stable sort.
  out.sort((a, b) => Number(b.updated_at) - Number(a.updated_at));
  return out;
}

/** `_web_activity.api_activity` (GET). */
export function apiActivity(state) {
  const enabled = activityEnabled(state);
  return { enabled, activity: enabled ? activityEntries(state) : [] };
}

/**
 * `_web_activity.api_activity_detail` — one session's snapshot plus its step timeline and
 * its UNCAPPED files/todos. 404 if the session is absent or has aged out; a missing or
 * garbage detail file degrades to an empty timeline rather than a 500.
 */
export function apiActivityDetail(state, sid) {
  const d = activityDir(state);
  // Resolve by the writer's safe-name scheme, which is also what keeps the read inside the
  // directory: every separator, `..` and drive colon becomes `_`, so there is no join to
  // steer. The `u` flag makes an astral character ONE replacement, as Python's code-point
  // `re.sub` does, rather than one per surrogate.
  const stem = sid.replace(/[^A-Za-z0-9_.-]/gu, '_');
  const snap = path.join(d, `${stem}.json`);
  const entry = isFile(snap) ? readEntry(snap) : null;
  if (entry === null || !isLive(entry, nowSeconds())) throw new NotFound(sid);
  const session = normalizeEntry(entry, stem);
  let timeline = [];
  let full = {};
  const det = readEntry(path.join(d, `${stem}.detail.json`));
  if (pyTruthy(det)) {
    const tl = Object.hasOwn(det, 'timeline') ? det.timeline : null;
    timeline = Array.isArray(tl) ? tl : [];
    full = det;
  }
  const fg = (k) => (Object.hasOwn(full, k) ? full[k] : null);
  // The detail file carries the uncapped lists; fall back to the snapshot's capped ones.
  // Assigning over an existing key keeps its POSITION in both languages, which is what lets
  // the response stay byte-comparable.
  session.files = pyTruthy(fg('files')) ? fg('files') : session.files;
  session.todos = pyTruthy(fg('todos')) ? fg('todos') : session.todos;
  // The compact transcript: an ordered list of {role, text, t} turns. Empty falls back to
  // the title as the opening user turn, because OpenCode derives the title from the first
  // prompt.
  const conv = fg('conversation');
  let conversation = Array.isArray(conv) ? conv : [];
  if (conversation.length === 0 && pyTruthy(session.title)) {
    conversation = [{ role: 'user', text: session.title }];
  }
  return { session, timeline, conversation };
}

/**
 * `_web_activity.api_activity_toggle` — flip the runtime on/off flag.
 *
 * The OpenCode plugin reads this file on every event, so the change takes effect without
 * restarting anything; writing `off` also makes the plugin clear its snapshots on its next
 * event, while the reader gates the surface immediately.
 *
 * `bool(body.get("enabled", True))` DEFAULTS TO ON — an empty body enables, which is the
 * arm a port spelled `body.enabled === true` inverts. And this is the one POST in P6f whose
 * result is sent at 200 whatever `ok` says: the 409 convention is per-route in the
 * reference, not a rule about the shape of the body.
 */
export function apiActivityToggle(state, body) {
  const raw = (body && Object.hasOwn(body, 'enabled')) ? body.enabled : true;
  const enabled = pyTruthy(raw);
  const p = activityFlag(state);
  try {
    mkdirSync(path.dirname(p), { recursive: true });
    writeText(p, enabled ? 'on' : 'off');
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
  return { ok: true, enabled };
}
