/**
 * The hook-side activity writer, and the one owner of what an activity snapshot's LIVENESS means.
 *
 * The OpenCode plugin (`adapters/opencode/plugins/geneseed-activity.js`) writes one snapshot per
 * session into `<cfg>/activity/`; this module writes the same files for the hosts whose hooks are
 * processes rather than a resident plugin — Claude Code, OpenClaude and Bob. The web reader
 * (`js/web/activity.mjs`) cannot tell the two writers apart, and must not need to: the schema is
 * the plugin's, plus `writer: "hook"`, `host`, and the two private cursors below (`normalizeEntry`
 * never returns them).
 *
 * NOT A NEW HOOK ON EVERY TOOL CALL. `bin/geneseed-hook.mjs` calls `recordActivity` after the verb
 * the host ran anyway has decided (the gates, `context`, `learn`), plus the `activity` verb for
 * the two events no other verb is wired to (UserPromptSubmit, SessionEnd). So a Claude session's
 * live phase moves only on the gated tools (`Bash|PowerShell`, `Write|Edit|NotebookEdit`,
 * `Skill|Agent|Task`); the rest of the turn's tool calls arrive at Stop, read out of the
 * transcript from a stored byte offset (`readTranscriptDelta`). Bob sends no `transcript_path`,
 * so a Bob session shows only what its matcher-less `tool-gate` sees, call by call.
 *
 * THIS MODULE IS NEVER LOADED WHEN TRACKING IS OFF — the entry checks the flag first, then imports
 * this file dynamically. It must never print: a hook's stdout is its verdict, and every write
 * here is best-effort (a hook that fails is a tool call that fails).
 *
 * WHAT IS RECORDED, AND WHAT NEVER IS. A tool's name, a file path's BASENAME, line counts, todo
 * text, a prompt snippet and the last assistant message snippet (240 characters each). Never a
 * shell command, a file's content or an edit's text: those are where secrets live.
 *
 * Liveness is owned here because two writers need it now. The hooks have no resident process,
 * so they record `pid: null` and are live by staleness alone; a plugin snapshot keeps its pid
 * probe. `status: "ended"` (SessionEnd) is never live. `sweepActivity` moves what is not live
 * into `activity/archive/`, and the reader lists the archive as ended sessions without ever
 * deleting or moving anything itself.
 */
import {
  closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readSync,
  renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { parseIntStrict, stripWhitespace } from '../lib/text.mjs';
import { SECRET_RE } from './hooks-prims.mjs';
import { sovereignBypass } from './hosts.mjs';

// Every snippet passes Law I's own pattern before it reaches disk; a match becomes this.
const SECRET_ALL = new RegExp(SECRET_RE.source, 'g');
// The names `safeStem` can produce, and only those: the sweep moves or deletes nothing else.
const SNAPSHOT_NAME = /^[A-Za-z0-9_.-]{1,128}\.json$/;

/**
 * A snapshot not touched in this long is not live. pid-liveness is the plugin's real signal; for
 * a hook writer, with no pid, this is the only one, so a session left waiting on the user for
 * longer than this moves to the archive at the next sweep and comes back on its next prompt.
 */
export const ACTIVITY_STALE_SECONDS = 1800;
/** The archive keeps the newest this many ended sessions, and none older than a week. */
export const ARCHIVE_KEEP = 50;
export const ARCHIVE_MAX_AGE_SECONDS = 7 * 24 * 3600;
/** One Stop reads at most this much new transcript; a longer delta keeps its newest bytes. */
export const TRANSCRIPT_CAP = 2 * 1024 * 1024;

// The plugin's caps, so a hook snapshot is the same size as a plugin one.
const FILE_CAP = 8;
const TODO_CAP = 12;
const LOG_CAP = 200;
const CONV_CAP = 60;
const CONV_LEN = 240;
const SNIPPET_LEN = 160;
const SID_CAP = 128;
// Edit tools count as touching a file only when they carry an edit, so a Read never counts.
const EDIT_FIELDS = ['content', 'new_string', 'new_source', 'diff'];

/**
 * The plugin's safe-name scheme, capped: every separator, `..`-forming slash and drive colon
 * becomes `_`, so a hostile session id can never steer the join out of the directory. The `u`
 * flag makes an astral character ONE replacement rather than one per surrogate half.
 */
export const safeStem = (sid) => String(sid).replace(/[^A-Za-z0-9_.-]/gu, '_').slice(0, SID_CAP);

/**
 * A raw pid value as an integer, or `null`. A parsed JSON number may be the reader's `JsonNumber`
 * wrapper, recognised by its numeric `valueOf`; a decimal string, a boolean and a float (truncated)
 * are what a hand-edited snapshot can produce.
 */
function toIntOr(raw) {
  if (raw === true) return 1;
  if (raw === false) return 0;
  if (typeof raw === 'string') return parseIntStrict(stripWhitespace(raw));
  const n = (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) ? raw.valueOf() : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/**
 * `process.kill(pid, 0)` probes without a spawn. ESRCH is dead; anything else (EPERM, a
 * locked-down host) errs toward alive, and staleness decides.
 */
function pidAlive(raw) {
  const pid = toIntOr(raw);
  if (pid === null || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return !(e && e.code === 'ESRCH');
  }
}

/**
 * Not ended, not stale, and — when the snapshot names a writer pid — that pid alive. A missing or
 * null pid is a hook writer's: staleness alone decides.
 */
export function isLive(entry, now) {
  if (entry.status === 'ended') return false;
  if ((now - (Number(entry.updated_at) || 0)) > ACTIVITY_STALE_SECONDS) return false;
  const pid = Object.hasOwn(entry, 'pid') ? entry.pid : null;
  return pid === null || pidAlive(pid);
}

/** A JSON object from `p`, or `null` for a missing, garbage or non-object file. */
function readJson(p) {
  try {
    const v = JSON.parse(readFileSync(p, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** tmp + rename, so a reader never sees half a file; last writer wins. */
function writeAtomic(file, obj) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
  try {
    renameSync(tmp, file);
  } catch (e) {
    // A reader holding the file open on Windows: drop this write, the next event rewrites it.
    try { unlinkSync(tmp); } catch { /* nothing more to do */ }
    if (!['EPERM', 'EBUSY', 'EACCES'].includes(e && e.code)) throw e;
  }
}

// Redacted on the WHOLE text, before the cut, so a secret the cut lands in is still whole.
const snip = (s, n = SNIPPET_LEN) => String(s ?? '').replace(SECRET_ALL, '[redacted]')
  .replace(/\s+/g, ' ').trim().slice(0, n);

/** True when `p` exists and is a symlink (or junction): the writer and sweep never follow one. */
function isLink(p) {
  try { return lstatSync(p).isSymbolicLink(); } catch { return false; }
}
const lineCount = (s) => (typeof s === 'string' && s ? s.split('\n').length : 0);
const baseOf = (p) => (typeof p === 'string' && p ? path.basename(p.replace(/\\/g, '/')) : null);

/**
 * The bytes of `file` written since `offset`, as parsed JSONL objects, and the offset to resume
 * from. Only COMPLETE lines are consumed, so a line the host is still writing is read next time.
 * A file shorter than the offset was replaced, and is read from the start; a delta longer than
 * `cap` keeps its newest `cap` bytes, minus the partial line the cut lands in.
 */
export function readTranscriptDelta(file, offset = 0, cap = TRANSCRIPT_CAP) {
  let fd;
  try {
    // A regular file only: opening a FIFO or a named pipe blocks the hook until a writer comes.
    if (!statSync(file).isFile()) return { entries: [], offset };
    fd = openSync(file, 'r');
  } catch {
    return { entries: [], offset };
  }
  try {
    const size = fstatSync(fd).size;
    let start = Number.isInteger(offset) && offset >= 0 && offset <= size ? offset : 0;
    let cut = false;
    if (size - start > cap) { start = size - cap; cut = true; }
    const buf = Buffer.alloc(size - start);
    const got = buf.length ? readSync(fd, buf, 0, buf.length, start) : 0;
    const end = buf.subarray(0, got).lastIndexOf(10);
    if (end < 0) return { entries: [], offset: start };
    let lines = buf.subarray(0, end).toString('utf8').split('\n');
    if (cut) lines = lines.slice(1);
    const entries = [];
    for (const l of lines) {
      try {
        const v = JSON.parse(l);
        if (v && typeof v === 'object') entries.push(v);
      } catch { /* a line that is not JSON is skipped, never fatal */ }
    }
    return { entries, offset: start + end + 1 };
  } finally {
    closeSync(fd);
  }
}

/** A tool call's one-line label: the tool and, at most, a file's basename or a skill's name. */
function toolLabel(name, input) {
  const file = baseOf(input.file_path ?? input.path ?? input.notebook_path);
  if (file) return `${name} ${file}`;
  const named = input.skill ?? input.subagent_type;
  return typeof named === 'string' && named ? `${name} ${snip(named, 60)}` : name;
}

/** Folds one tool call into the session's state: a timeline row, and its file or todo list. */
function applyTool(st, name, input, t, id, status) {
  if (typeof name !== 'string' || !name) return;
  const label = toolLabel(name, input);
  const kind = ['Agent', 'Task'].includes(name) ? 'subtask' : 'tool';
  const row = id ? st.timeline.find((r) => r.id === id) : null;
  if (row) {
    row.status = status;
  } else {
    st.timeline.push({ t, kind, label, tool: name, status, ...(id ? { id } : {}) });
    const file = baseOf(input.file_path ?? input.path ?? input.notebook_path);
    if (file && EDIT_FIELDS.some((k) => typeof input[k] === 'string')) {
      let f = st.files.find((x) => x.file === file);
      if (!f) { f = { file, additions: 0, deletions: 0 }; st.files.push(f); }
      f.additions += lineCount(input.content ?? input.new_string ?? input.new_source);
      f.deletions += lineCount(input.old_string);
    }
  }
  if (Array.isArray(input.todos)) {
    st.todos = input.todos.filter((x) => x && typeof x === 'object')
      .map((x) => ({ content: snip(x.content, CONV_LEN), status: String(x.status ?? 'pending') }));
  }
  return label;
}

/** Folds a transcript delta (Claude's JSONL) in: model, token totals, tool calls, last reply. */
function applyTranscript(st, entries, nowMs) {
  const counted = new Set(st.last_message_id ? [st.last_message_id] : []);
  let reply = null;
  for (const e of entries) {
    const m = e.type === 'assistant' && e.message && typeof e.message === 'object' ? e.message : null;
    if (!m) continue;
    if (typeof m.model === 'string' && m.model && !m.model.startsWith('<')) st.model = m.model;
    if (typeof m.id === 'string' && m.usage && !counted.has(m.id)) {
      counted.add(m.id);
      st.last_message_id = m.id;
      st.tokens += (Number(m.usage.input_tokens) || 0) + (Number(m.usage.output_tokens) || 0);
    }
    const t = Date.parse(e.timestamp) || nowMs;
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (b && b.type === 'tool_use') {
        applyTool(st, b.name, b.input && typeof b.input === 'object' ? b.input : {}, t, b.id, 'completed');
      } else if (b && b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
        reply = { text: b.text, t };
      }
    }
  }
  return reply;
}

/** `{count, additions, deletions, items}` over a file list, `items` capped at `cap`. */
function filesSummary(items, cap) {
  if (!items.length) return null;
  const sum = (k) => items.reduce((a, f) => a + f[k], 0);
  return { count: items.length, additions: sum('additions'), deletions: sum('deletions'),
    items: items.slice(0, cap) };
}

function todosSummary(items, cap) {
  if (!items) return null;
  return { done: items.filter((x) => x.status === 'completed').length, total: items.length,
    items: items.slice(0, cap) };
}

const ROLL = { SessionStart: 'idle', UserPromptSubmit: 'busy', PreToolUse: 'busy',
  Stop: 'waiting-input', SessionEnd: 'ended' };
const KNOWN = new Set([...Object.keys(ROLL), 'SubagentStop', 'PreCompact']);

/**
 * The previous snapshot and detail (or null), a hook payload, and the clock → the next
 * `{snap, detail}`, or `null` when the event is not one this writer records. NOT pure: the new
 * detail reuses, and updates in place, `prevDetail`'s lists — the caller writes the result and
 * discards the input, so a copy would only cost time on the hook path. `delta` is what
 * `readTranscriptDelta` returned for a Stop, or null. Claude-shaped and Bob-shaped payloads
 * (`{event, tool, input}`) are both read; a tool payload with no event name is a PreToolUse.
 */
export function applyHookEvent(prev, prevDetail, payload, now, { host = 'claude', delta = null } = {}) {
  const p = payload;
  const tool = typeof p.tool_name === 'string' ? p.tool_name : (typeof p.tool === 'string' ? p.tool : null);
  let ev = typeof p.hook_event_name === 'string' ? p.hook_event_name
    : (typeof p.event === 'string' ? p.event : null);
  if (!ev && tool) ev = 'PreToolUse';
  if (!KNOWN.has(ev)) return null;
  const nowMs = Math.round(now * 1000);
  const det = prevDetail || {};
  const snap = prev ? { ...prev } : {
    session_id: p.session_id, agent: null, title: null, cwd: null, status: 'idle', pid: null,
    writer: 'hook', host,
  };
  const st = {
    timeline: Array.isArray(det.timeline) ? det.timeline : [],
    conversation: Array.isArray(det.conversation) ? det.conversation : [],
    files: Array.isArray(det.files?.items) ? det.files.items : [],
    todos: Array.isArray(det.todos?.items) ? det.todos.items : null,
    model: snap.model ?? null,
    tokens: Number(snap.tokens) || 0,
    last_message_id: snap.last_message_id ?? null,
  };
  snap.updated_at = now;
  if (typeof p.cwd === 'string' && p.cwd) snap.cwd = p.cwd;
  if (typeof p.model === 'string' && p.model) st.model = p.model;
  if (ROLL[ev]) snap.status = ROLL[ev];
  if (ev === 'SessionStart') {
    st.timeline.push({ t: nowMs, kind: 'step', label: `Session ${snip(p.source || 'start', 20)}`, status: 'completed' });
  } else if (ev === 'UserPromptSubmit') {
    snap.turn_started_at = now;
    snap.phase = null;
    if (typeof p.prompt === 'string' && p.prompt.trim()) {
      if (!snap.title) snap.title = snip(p.prompt);
      st.conversation.push({ role: 'user', text: snip(p.prompt, CONV_LEN), t: nowMs });
    }
  } else if (ev === 'PreToolUse') {
    const input = (p.tool_input && typeof p.tool_input === 'object') ? p.tool_input
      : ((p.input && typeof p.input === 'object') ? p.input : {});
    const label = applyTool(st, tool, input, nowMs, typeof p.tool_use_id === 'string' ? p.tool_use_id : null, 'running');
    if (label) snap.phase = label;
  } else if (ev === 'Stop') {
    const reply = delta ? applyTranscript(st, delta.entries, nowMs) : null;
    if (delta) snap.transcript_offset = delta.offset;
    const last = typeof p.last_assistant_message === 'string' ? p.last_assistant_message : reply?.text;
    if (last && last.trim()) st.conversation.push({ role: 'assistant', text: snip(last, CONV_LEN), t: nowMs });
    for (const r of st.timeline) if (r.status === 'running') r.status = 'completed';
    snap.phase = null;
    snap.turn_started_at = null;
  } else if (ev === 'SubagentStop') {
    const who = typeof p.agent_type === 'string' && p.agent_type ? ` ${snip(p.agent_type, 60)}` : '';
    st.timeline.push({ t: nowMs, kind: 'subtask', label: `Subagent${who} done`, status: 'completed' });
  } else if (ev === 'PreCompact') {
    st.timeline.push({ t: nowMs, kind: 'step', label: 'Compacting', status: 'completed' });
  } else if (ev === 'SessionEnd') {
    snap.phase = null;
    snap.turn_started_at = null;
  }
  snap.model = st.model;
  snap.tokens = st.tokens;
  if (st.last_message_id) snap.last_message_id = st.last_message_id;
  snap.files = filesSummary(st.files, FILE_CAP);
  snap.todos = todosSummary(st.todos, TODO_CAP);
  const detail = {
    files: filesSummary(st.files, Infinity),
    todos: todosSummary(st.todos, Infinity),
    conversation: st.conversation.slice(-CONV_CAP),
    timeline: st.timeline.slice(-LOG_CAP),
  };
  return { snap, detail };
}

/**
 * One hook event, recorded. `raw` is the payload text exactly as the host sent it on stdin.
 * Returns whether a snapshot was written. Throws only on an unexpected filesystem error, which
 * the entry swallows; a payload with no `session_id` or a sovereign-bypassed repo writes nothing.
 */
export function recordActivity(root, raw, { host = 'claude', now = Date.now() / 1000 } = {}) {
  let p;
  try { p = JSON.parse(raw); } catch { return false; }
  if (!p || typeof p !== 'object' || typeof p.session_id !== 'string' || !p.session_id.trim()) return false;
  if (sovereignBypass(root)) return false;
  const dir = path.join(root, 'activity');
  // A linked `activity/` (one a repo could commit) is never written through.
  if (isLink(dir)) return false;
  const stem = safeStem(p.session_id);
  const snapFile = path.join(dir, `${stem}.json`);
  const detFile = path.join(dir, `${stem}.detail.json`);
  // A session the sweep archived (stale while waiting on the user) resumes from its archived
  // copy, so its title and totals survive; the reader lets the live copy win the duplicate.
  let prev = readJson(snapFile);
  let prevDet = prev ? readJson(detFile) : null;
  if (!prev) {
    prev = readJson(path.join(dir, 'archive', `${stem}.json`));
    if (prev) prevDet = readJson(path.join(dir, 'archive', `${stem}.detail.json`));
  }
  const ev = p.hook_event_name ?? p.event;
  const delta = ev === 'Stop' && typeof p.transcript_path === 'string'
    ? readTranscriptDelta(p.transcript_path, prev ? Number(prev.transcript_offset) || 0 : 0) : null;
  const next = applyHookEvent(prev, prevDet, p, now, { host, delta });
  if (!next) return false;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // A project install's `activity/` sits inside the repo (`<repo>/.claude/activity/`): it must
  // never be committed. Create-if-absent, so a user's own edit to the file survives.
  try { writeFileSync(path.join(dir, '.gitignore'), '*\n', { flag: 'wx', mode: 0o600 }); } catch { /* exists */ }
  writeAtomic(detFile, next.detail);
  writeAtomic(snapFile, next.snap);
  if (ev === 'SessionStart' || ev === 'SessionEnd') sweepActivity(dir, now);
  return true;
}

/**
 * `[name, entry]` for every session snapshot in `d` that this module may touch: a name
 * `safeStem` can produce, and a JSON object carrying a string `session_id` — what both writers
 * put in every snapshot. A file that fails either test (a user's file, a garbage file) is never
 * listed, so it is never moved or deleted.
 */
function snapshots(d) {
  let names;
  try {
    names = readdirSync(d);
  } catch {
    return [];
  }
  return names.filter((n) => SNAPSHOT_NAME.test(n) && !n.endsWith('.detail.json')).sort()
    .map((n) => [n, readJson(path.join(d, n))])
    .filter(([, e]) => e !== null && typeof e.session_id === 'string');
}

/**
 * Moves every snapshot in `dir` that is not live into `dir/archive/` (its detail file with it),
 * then keeps the archive to the newest `ARCHIVE_KEEP`, none older than `ARCHIVE_MAX_AGE_SECONDS`.
 * Called by the writer on SessionStart and SessionEnd — never by a GET. Stands down when `dir`
 * or `archive/` is a link: a repo that committed `activity/archive` as a link to elsewhere
 * would otherwise have the sweep move and delete files there.
 */
export function sweepActivity(dir, now = Date.now() / 1000) {
  const arch = path.join(dir, 'archive');
  if (isLink(dir) || isLink(arch)) return;
  const move = (name) => {
    try { renameSync(path.join(dir, name), path.join(arch, name)); } catch { /* best-effort */ }
  };
  for (const [name, e] of snapshots(dir)) {
    if (isLive(e, now)) continue;
    try { mkdirSync(arch, { recursive: true, mode: 0o700 }); } catch { return; }
    move(`${name.slice(0, -'.json'.length)}.detail.json`);
    move(name);
  }
  const kept = snapshots(arch).map(([name, e]) => ({ name, updated: Number(e.updated_at) || 0 }))
    .sort((a, b) => b.updated - a.updated);
  kept.forEach(({ name, updated }, i) => {
    if (i < ARCHIVE_KEEP && now - updated <= ARCHIVE_MAX_AGE_SECONDS) return;
    for (const n of [name, `${name.slice(0, -'.json'.length)}.detail.json`]) {
      try { unlinkSync(path.join(arch, n)); } catch { /* already gone */ }
    }
  });
}
