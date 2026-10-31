/**
 * The live-activity surface. A GET reads; it never writes, deletes or moves a file — the loop
 * join included, which reads the registry through the read-only `runningLoops`.
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
 * ONE GARDEN OVER EVERY ACTIVE INSTALL. `apiActivity` is machine-wide, like `/api/usage`: it reads
 * `<viewCfg(install)>/activity` of each active install (`activeInstalls`) and merges the cards.
 * Each card, ended row and collision writer carries `install`, the same `host:scope:root` string
 * `/api/usage` keys its rows by; the top-level `installs[]` maps it to `{host, scope, path,
 * enabled}`, `path` being the root verbatim, so a client names the install back (`?host=&path=`)
 * without parsing a key whose Windows root holds a `:`. One session two installs both recorded
 * is one card (`mergeCopies`), which lists them in `installs`. Collisions and the loop join run ONCE over
 * the merged live list, so a claude and an opencode session on one file are a collision. The
 * on/off flag stays per install: the detail (`/api/activity/<sid>`) and the toggle read the
 * install the request names, through `installView`.
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
import { mkdirSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { readText, writeText, isDir, isFile } from '../lib/fs.mjs';
import { parseJson, isTruthy } from '../lib/json.mjs';
import { normcase } from '../lib/paths.mjs';
import { stripWhitespace } from '../lib/text.mjs';
import { ARCHIVE_KEEP, ARCHIVE_MAX_AGE_SECONDS, isLive, safeStem, sweepActivity } from '../hosts/activity.mjs';
import { installState, installTargets } from '../hosts/installs.mjs';
import { runningLoops } from '../loop/registry.mjs';
import { NotFound, stemOf } from './catalog.mjs';
import { fleetSort, viewCfg } from './state.mjs';

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
 * Each active install that records activity, as `{install, host, scope, path, dir}`; `install` is
 * usage-api's key. An OpenCode PROJECT install is left out: the OpenCode plugin writes its cards and
 * reads its `.geneseed-activity` flag in the GLOBAL OpenCode config dir whichever install loaded it,
 * so a project row would hold an empty dir and a switch nobody reads. Its sessions appear under, and
 * follow the switch of, the OpenCode global row. `installState` runs per install inside a catch: one
 * broken install is skipped, never a blank garden. Rows come in the fixed order below.
 */
function installRows(targets) {
  const rows = [];
  for (const [host, scope, root] of targets) {
    if (host === 'opencode' && scope !== 'global') continue;
    let active;
    try { active = installState(root, host, scope) === 'active'; } catch { continue; }
    if (active) {
      rows.push({ install: `${host}:${scope}:${root}`, host, scope, path: String(root),
        dir: viewCfg(host, scope, root) });
    }
  }
  // The fleet's FIXED order (`fleetSort`). A merged card's primary install is the first of its
  // installs in it.
  return fleetSort(rows, (r) => [r.host, r.scope]);
}

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
    // The console's host filter reads this. The hook writer stamps it; the only other writer is
    // the OpenCode plugin, which does not, so a snapshot without `writer: 'hook'` is OpenCode's.
    host: or('host', g('writer') === 'hook' ? null : 'opencode'),
    // Snapshot v2, the Activity garden. `root` is the worktree, `repo` its main worktree;
    // `attribution` is `false` only on a Bob session that ran a sub-agent, so it is read with
    // `g`, never `or` (which would turn that `false` into the default).
    root: g('root'),
    repo: g('repo'),
    agents: Array.isArray(g('agents')) ? g('agents') : [],
    attribution: g('attribution'),
    turns: or('turns', 0),
    context: g('context'),
    compactions: or('compactions', 0),
    compacted_at: g('compacted_at'),
    context_at_compaction: g('context_at_compaction'),
    // The shelf key for the garden: writers store `repo` as the host spelled `cwd` (Bob `c:\`,
    // Claude `C:\`), and the browser cannot know the platform's case rule, so it is folded here.
    repo_key: typeof (g('repo') ?? g('root')) === 'string' ? normcase(g('repo') ?? g('root')) : null,
  };
}

/** The `files.items` array of a files summary, or `[]`. */
const itemsOf = (files) => (Array.isArray(files?.items) ? files.items : []);

/**
 * The uncapped file rows of one session (B2): the detail file's `files.items`, else the
 * snapshot's capped ones. The detail sits beside the snapshot under the same stem.
 */
function allFiles(d, stem, session) {
  const det = readEntry(path.join(d, `${stem}.detail.json`));
  return isTruthy(det?.files) ? itemsOf(det.files) : itemsOf(session.files);
}

/**
 * The join key of a session root against the loop registry. The registry stores each root as its
 * realpath, so a session root reached through a junction, a symlink or another spelling is
 * resolved the same way first; a root that no longer exists falls back to itself.
 */
const loopKey = (root) => {
  try { return normcase(realpathSync.native(root)); } catch { return normcase(root); }
};

/**
 * Loop rows by `normcase(root)`, running ones only (B9): `runningLoops` leaves out a finished
 * loop (no LOOP.md) and an unreadable one (no state to show); `awaiting` or `stopped` stay, with
 * their status. It reads every registered LOOP.md, so it is called once per request, and only
 * when some live session is in a repo. It never saves `loops.json`: pruning stays with
 * `activeLoops`, so a 2 s Activity poll cannot race `recordLoop`.
 */
function loopsByRoot(sessions) {
  const byRoot = new Map();
  if (!sessions.some((s) => typeof s.root === 'string')) return byRoot;
  for (const l of runningLoops()) {
    const k = normcase(l.root);
    if (!byRoot.has(k)) byRoot.set(k, []);
    byRoot.get(k).push({ title: l.title, iteration: l.iteration, status: l.status });
  }
  return byRoot;
}

/**
 * B5 + D11: two or more distinct writers `(sid, by)` on one `(repo, path)` among the live
 * sessions. `same-worktree` (a real collision) when any two of them share `root`, else
 * `cross-worktree` (a merge-conflict risk). Keys go through `normcase` (Bob writes `c:\`); the
 * output keeps the first spelling seen. Sessions are walked by id and writers sorted, so the
 * answer does not depend on `updated_at`. A row whose `path` is not a string takes no
 * part: a v1 row, or `path: null` for a file outside the root (its `file` keeps the basename).
 * Neither does a session without a repo.
 */
function collisionsOf(sessions) {
  const byFile = new Map();
  const idOf = (s) => s.key ?? `${s.install ?? ''}\0${s.session_id}`;
  const ordered = [...sessions].sort((a, b) => (idOf(a) < idOf(b) ? -1 : 1));
  for (const s of ordered) {
    const repo = typeof s.repo === 'string' ? s.repo : s.root;
    if (typeof repo !== 'string') continue;
    for (const f of s.files_all) {
      if (typeof f?.path !== 'string') continue;
      const key = `${normcase(repo)}\0${normcase(f.path)}`;
      if (!byFile.has(key)) byFile.set(key, { repo, path: f.path, writers: new Map() });
      const by = f.by ?? null;
      // Keyed by install too. Copies of one session in one checkout are already one card
      // (`mergeCopies`); an id left in two installs is two checkouts, so two writers.
      byFile.get(key).writers.set(`${idOf(s)}\0${by}`,
        { sid: s.session_id, by, root: s.root, install: s.install ?? null, key: s.key ?? null });
    }
  }
  const out = [];
  for (const { repo, path: p, writers } of byFile.values()) {
    if (writers.size < 2) continue;
    const wk = (w) => `${w.sid}\0${w.install ?? ''}\0${w.by ?? ''}`;
    const list = [...writers.values()].sort((a, b) => (wk(a) < wk(b) ? -1 : 1));
    const roots = list.map((w) => (typeof w.root === 'string' ? normcase(w.root) : null));
    const shared = roots.some((r, i) => r !== null && roots.indexOf(r) !== i);
    out.push({ repo, path: p, writers: list, kind: shared ? 'same-worktree' : 'cross-worktree' });
  }
  return out.sort((a, b) => (`${a.repo}\0${a.path}` < `${b.repo}\0${b.path}` ? -1 : 1));
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
 * A session's identity across installs, and the card's `key`: its id plus its checkout, `root`
 * (else `cwd`) case-folded where the platform folds and with any trailing separator dropped, so
 * `C:\w\main\` is `C:\w\main`. It never names an install, so it holds still when the shown copy moves.
 */
const sessionKey = (e) => {
  const w = typeof e.root === 'string' ? e.root : e.cwd;
  return `${e.session_id}\0${typeof w === 'string' ? normcase(w).replace(/[\\/]+$/, '') : ''}`;
};

/**
 * `{live, ended}` of ONE activity dir, each card tagged with `install`: the live sessions, and
 * the ones that are not — still in the directory or already archived — each listed once, the
 * live copy and then the directory's winning. Per install, so a live claude `s1` never hides an
 * ended opencode `s1`. Neither loops nor collisions here: those join the merged list.
 */
function dirEntries(d, install, now) {
  const live = [];
  const ended = [];
  const seen = new Set();
  const rest = [];
  for (const [name, entry] of snapshots(d)) {
    const n = normalizeEntry(entry, stemOf(name));
    const e = /** @type {Record<string, any>} */ ({ ...n, install, installs: [install], key: sessionKey(n) });
    if (isLive(entry, now)) {
      e.files_all = allFiles(d, stemOf(name), e);
      live.push(e);
      seen.add(String(e.session_id));
    } else rest.push(e);
  }
  for (const [name, entry] of snapshots(path.join(d, 'archive'))) {
    const n = normalizeEntry(entry, stemOf(name));
    rest.push({ ...n, install, installs: [install], key: sessionKey(n) });
  }
  for (const e of rest) {
    if (seen.has(String(e.session_id))) continue;
    seen.add(String(e.session_id));
    if (now - Number(e.updated_at) > ARCHIVE_MAX_AGE_SECONDS) continue;
    ended.push({ ...e, ended: true });
  }
  return { live, ended };
}

/**
 * One card per session. A global and a project install of one Claude-shaped host both run
 * `geneseed-hook activity --root <own install>` for the same session, so the same session lands in
 * two dirs. Copies with an equal `key` (`sessionKey`: id and checkout) are ONE card. Its DATA is
 * the newest `updated_at`'s copy; its `installs` are every install that saw it and its `install`
 * (the chip, and the install the detail link reads) the first of them, both in the fixed order of
 * `rank` (`installRows`'s order) — never by recency, since two installs write one session within
 * milliseconds and the newest copy can change between two polls. A live copy also absorbs an ended
 * copy elsewhere, but a live card's `install` is the first install holding a LIVE copy: a stale
 * ended copy would send the detail link to a session shown as ended. Without this the session
 * would collide with itself.
 */
function mergeCopies(live, ended, rank) {
  const by = new Map();
  const keep = (list) => newestFirst(list).filter((e) => {
    const had = by.get(e.key);
    if (!had) { by.set(e.key, e); return true; }
    if (!had.installs.includes(e.install)) had.installs.push(e.install);
    return false;
  });
  const byRank = (x, y) => rank.get(x) - rank.get(y);
  const out = { live: keep(live) };
  const liveIn = new Map(out.live.map((e) => [e.key, [...e.installs]]));
  out.ended = keep(ended);
  for (const e of by.values()) {
    e.installs.sort(byRank);
    e.install = (liveIn.get(e.key)?.sort(byRank) ?? e.installs)[0];
  }
  return out;
}
/**
 * GET /api/activity, machine-wide: `{enabled, installs[], activity, ended, collisions}` over every
 * active install in `targets`. An install whose flag is off contributes no card. `enabled` is
 * true when ANY install tracks (or none is active), so the Overview's "tracking is off" notice
 * fires only once every install is off. `ended` is capped after the merge, to one archive's rule.
 */
export function activitySummary({ targets = installTargets() } = {}) {
  const now = nowSeconds();
  const installs = [];
  const live = [];
  const ended = [];
  for (const { dir, ...row } of installRows(targets)) {
    const enabled = activityEnabled({ target: dir });
    installs.push({ ...row, enabled });
    if (!enabled) continue;
    const got = dirEntries(path.join(dir, 'activity'), row.install, now);
    live.push(...got.live);
    ended.push(...got.ended);
  }
  const one = mergeCopies(live, ended, new Map(installs.map((i, n) => [i.install, n])));
  const loops = loopsByRoot(one.live);
  for (const e of one.live) e.loops = typeof e.root === 'string' ? loops.get(loopKey(e.root)) ?? [] : [];
  return {
    enabled: installs.length === 0 || installs.some((i) => i.enabled),
    installs,
    activity: one.live,
    ended: one.ended.slice(0, ARCHIVE_KEEP),
    collisions: collisionsOf(one.live),
  };
}

export const apiActivity = () => activitySummary();

/**
 * Archive the ended sessions of every active install (`sweepActivity`), each on its own: one
 * unreadable dir never skips the rest. The daemon runs it at start and every 10 minutes, and
 * re-reads the installs each time, so an install added since is swept too. Only ACTIVE installs are
 * swept (installRows): a disabled or absent install's `activity/` is left as it is.
 */
export function sweepInstalls({ targets = installTargets() } = {}) {
  let rows;
  try { rows = installRows(targets); } catch { return; }
  for (const { dir } of rows) {
    try { sweepActivity(path.join(dir, 'activity')); } catch { /* best-effort */ }
  }
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
  // The garden's fields, as `apiActivity` gives a live session: `files` is uncapped here already.
  session.files_all = itemsOf(session.files);
  session.loops = session.ended || typeof session.root !== 'string'
    ? [] : loopsByRoot([session]).get(loopKey(session.root)) ?? [];
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
