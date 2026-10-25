// Geneseed — OpenCode live-activity writer plugin.
//
// Surfaces what the harness is DOING (not just what it is) to the web console's
// Activity view. Writes one small JSON file per session into the OpenCode config
// dir's `activity/` folder; the web console's activity reader globs and renders them.
// Fully decoupled: the writer never talks to the reader, only the filesystem —
// language-agnostic, crash-isolated, no RPC. Mirrors the file-IPC seam
// the other plugins already use (geneseed-ponytail's state file, geneseed-workflow's
// per-run trace shards).
//
// ONE FILE PER SESSION (`activity/<session_id>.json`), owned exclusively by the
// process that created the session — so concurrent `opencode` invocations never
// contend on a shared file and no lock is needed. Atomic write (tmp + rename) keeps
// the reader from ever seeing a torn file. The reader lists an entry whose `pid` is
// dead or whose `updated_at` is stale as ended, and never deletes it.
//
// ONE CARD PER ROOT SESSION. A child session (one with a parentID: a `task` / `subagent`
// sub-agent) gets no card of its own; it becomes a row of its root session's `agents`
// (running while the child is busy, done when it goes idle), and the files it changes fold
// into the root's `files` with `by` = the child id. The learn plugin's throwaway `geneseed-*`
// distil sessions are skipped entirely, and so is a child whose parent this process does not
// track.
//
// Snapshot v2 (the Activity garden) adds `files[].path` and `files[].by`, `root` (OpenCode's
// own worktree), `repo` (its main checkout), `agents`, `turns`, `context` and the compaction
// trio — see docs/reference/opencode-plugins.md.
//
// v1.1 enriches each entry from events/fields it already receives or one `case` away:
// the current phase (tool/thinking), model, session token+cost totals, turn-elapsed,
// files-touched + churn, the todo/plan, blocked-on-permission, and the last error.
//
// GENESEED_ACTIVITY=off disables it. GENESEED_DEBUG=1 logs writes. Every failure is
// swallowed — it never blocks a session. See docs/specs/2026-06-15-live-activity-surface.md
// and docs/specs/2026-06-18-activity-v1.1-enriched-cards.md.

import fs, { existsSync, statSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

// GENESEED_ACTIVITY=off is a hard kill switch at startup; the web console's runtime
// toggle is the .geneseed-activity flag file checked per event (see isEnabled).
const ENV_OFF = ["off", "0", "false", "no"].includes((process.env.GENESEED_ACTIVITY || "on").toLowerCase())
const DEBUG = !!process.env.GENESEED_DEBUG
const PID = process.pid
function log(msg) { if (DEBUG) console.error(`[geneseed-activity] ${msg}`) }

// The OpenCode config dir, resolved to EXACTLY match the reader's own config-dir
// precedence ($OPENCODE_CONFIG_DIR > $XDG_CONFIG_HOME/opencode > ~/.config/opencode).
// Copying geneseed-ponytail's statePath() verbatim would check XDG only and diverge
// from the reader whenever $OPENCODE_CONFIG_DIR is set — the one path-divergence bug
// this seam exists to avoid.
function configBase() {
  return (
    process.env.OPENCODE_CONFIG_DIR ||
    path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode")
  )
}
function activityDir() { return path.join(configBase(), "activity") }

// The runtime on/off flag the web console writes (one word). Beside the OpenCode
// config like geneseed-ponytail's state file, and read every event so the toggle
// takes effect without restarting opencode. The reader resolves the same path
// (state.target / ".geneseed-activity").
function stateFile() { return path.join(configBase(), ".geneseed-activity") }

// Pure: a flag-file body disables only when it explicitly says so; absent/empty/
// anything-else → enabled. Exported for tests.
function enabledFromFlag(raw) {
  return !["off", "0", "false", "no"].includes(String(raw ?? "").trim().toLowerCase())
}
function isEnabled() {
  if (ENV_OFF) return false
  try { return enabledFromFlag(fs.readFileSync(stateFile(), "utf8")) } catch { return true }
}

// Bound the inline lists written per session; the v1.2 detail page carries the full ones.
const FILE_CAP = 8
const TODO_CAP = 12
// v1.2 detail file (timeline). LOG_CAP bounds the ring; the detail write is throttled
// so a text-streaming turn doesn't rewrite the file per delta; SNIPPET_LEN bounds the
// one-line text/reasoning records (no full prose to the console).
const LOG_CAP = 200
const DETAIL_THROTTLE_MS = 700
const SNIPPET_LEN = 160
// The conversation transcript (one bounded turn per user/assistant message) is capped
// so a very long chat stays bounded on disk; oldest turns drop first.
const CONV_CAP = 60

// --- pure helpers (exported for tests) ---------------------------------------

// Session id from an event's properties, across the shapes OpenCode uses:
// session.status / permission.* carry `sessionID`; message.updated's `info` (a Message)
// carries `sessionID`; message.part.updated's `part` carries `sessionID`; session.*
// carry `info` (a Session) whose own id is `id`.
function sidOf(props) {
  if (!props) return null
  return props.sessionID
    ?? props.info?.sessionID
    ?? props.part?.sessionID
    ?? props.info?.id
    ?? null
}

// The status an event implies, or null for "no change". busy/retry → busy; a
// finished turn (session.idle) → waiting-input ("your move"); session.status idle →
// idle; any streaming message → busy.
function nextStatus(type, statusType) {
  switch (type) {
    case "session.idle": return "waiting-input"
    case "message.updated":
    case "message.part.updated": return "busy"
    case "session.status": return statusType === "idle" ? "idle" : "busy"   // busy | retry
    case "session.created": return "idle"
    default: return null
  }
}

// A readable one-liner from an OpenCode error — a plain string (ToolStateError) or the
// {name, data:{message}} union (AssistantMessage.error / session.error). null → null.
function errStr(e) {
  if (!e) return null
  if (typeof e === "string") return e
  return e.data?.message || e.name || "error"
}

// Per-session token+cost accumulator. cost/tokens are per-AssistantMessage and
// message.updated re-fires for the SAME streaming message (same id, growing numbers),
// so we key by message id and sum — same id overwrites (streaming), new id adds (next
// turn). Mutates `map`, returns the session totals. Exported for tests.
function acctTotals(map, msgId, cost, tokens) {
  map.set(msgId, { cost: cost || 0, tokens: tokens || 0 })
  let c = 0, t = 0
  for (const v of map.values()) { c += v.cost; t += v.tokens }
  return { cost: c, tokens: t }
}

// Where a FileDiff's file is, for the garden: OpenCode's own path (relative to the worktree,
// `/`-separated) when there is a root, else null — as for anything that would leave the root
// or is absolute (`../`, `/`, a drive, a UNC path). Never an absolute path on disk, and never
// a basename in `path`, where it would collide with a same-named file at the top of the repo.
function relPath(file, root) {
  const p = String(file).replace(/\\/g, "/")
  if (!root || p.startsWith("/") || /^[A-Za-z]:/.test(p) || p === ".." || p.startsWith("../")) return null
  return p
}

// FileDiff lists -> the entry's files block. Lists sum per (OpenCode's raw path, by), so one
// session-wide list passes through unchanged and several per-turn lists become the session's
// churn; two files of one name stay two rows even when `path` is null. Only {file, path,
// additions, deletions, by} goes to disk: a FileDiff also carries `patch`, the full diff
// text, which never does. An entry without `file` (optional upstream) is dropped. A count
// upstream does not give (V2's step files) stays null rather than reading as 0.
// Pure; exported for tests. slimDiff trims a list as it is stored, so no patch text is
// held in memory for the life of the session either (`raw` is the merge key, memory only).
const slimDiff = (d, by = null, root = null) => {
  const raw = d?.file ? String(d.file).replace(/\\/g, "/") : null
  return { raw, file: raw && path.posix.basename(raw), path: raw && relPath(raw, root),
    additions: d?.additions ?? null, deletions: d?.deletions ?? null, by }
}
const addCount = (a, b) => (b == null ? a : (a ?? 0) + b)
function foldDiffs(lists) {
  const byKey = new Map()
  for (const list of lists) for (const d of list) {
    if (!d?.raw) continue
    const key = `${d.raw}\0${d.by ?? ""}`
    const f = byKey.get(key) ?? { file: d.file, path: d.path, additions: null, deletions: null, by: d.by ?? null }
    f.additions = addCount(f.additions, d.additions); f.deletions = addCount(f.deletions, d.deletions)
    byKey.set(key, f)
  }
  const items = [...byKey.values()]
  return {
    count: items.length,
    additions: items.reduce((n, f) => n + (f.additions || 0), 0),
    deletions: items.reduce((n, f) => n + (f.deletions || 0), 0),
    items,
  }
}

// The session's own turn diff is a snapshot of the whole worktree, so the turn a sub-agent
// was launched in (and every later one: a background child outlives its turn) also holds the
// files that sub-agent changed. Each of the session's own (`by: null`) rows is dropped from a
// turn list keyed at or after the launch turn of a sub-agent that reported the same file, or
// each sub-agent edit would be drawn twice; a parent edit from an earlier turn stays the
// parent's. `turns` is Map(key -> slim rows), `launchedIn` Map(child sid -> the parent's
// user-message id at launch, null when none was seen). Turn order is id order: OpenCode ids
// ascend, and V2's per-step keys are `files:<assistantMessageID>`, which sort after the
// prompt that started their turn. Pure; returns the lists to fold.
function ownRowsDeduped(turns, launchedIn) {
  const since = new Map()   // raw path -> the earliest launch turn of a child that reported it
  for (const list of turns.values()) for (const d of list) {
    if (d.by == null || !launchedIn.has(d.by)) continue
    const at = launchedIn.get(d.by) ?? ""
    if (!since.has(d.raw) || at < since.get(d.raw)) since.set(d.raw, at)
  }
  const order = (key) => String(key).replace(/^files:/, "")
  return [...turns].map(([key, list]) => list.filter((d) =>
    d.by != null || !since.has(d.raw) || order(key) < since.get(d.raw)))
}

// The fs-only readers below are twins of js/hosts/gitref.mjs (gitRootOf, gitDirOf,
// mainWorktreeOf): a plugin is copied whole into an install and cannot import js/.
// tests/plugins/activity.test.mjs compares each with its original, quotes, semicolons and
// layout aside; change one, change both.
function gitRootOf(cwd) {
  try {
    let dir = path.resolve(cwd)
    for (;;) {
      if (existsSync(path.join(dir, ".git"))) return dir
      const up = path.dirname(dir)
      if (up === dir) return null
      dir = up
    }
  } catch {
    return null
  }
}
function gitDirOf(root) {
  const dotgit = path.join(root, ".git")
  if (statSync(dotgit).isFile()) {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotgit, "utf8"))
    if (!m) throw new Error(`${dotgit} does not name a gitdir`)
    return path.resolve(root, m[1])
  }
  return dotgit
}
function mainWorktreeOf(cwd) {
  try {
    const root = gitRootOf(cwd)
    if (!root || !statSync(path.join(root, ".git")).isFile()) return null
    const gitdir = gitDirOf(root)
    const common = path.resolve(gitdir, readFileSync(path.join(gitdir, "commondir"), "utf8").trim())
    return path.basename(common) === ".git" ? path.dirname(common) : null
  } catch {
    return null
  }
}

// `root` from OpenCode's own worktree: V1 passes the checkout's top level (a linked worktree
// is its own root), or "/" for a project outside a repository — as is the drive root a
// global project resolves to, so a filesystem root is no root. `repo` is the main checkout,
// the root itself on a main checkout.
function rootsOf(worktree) {
  if (typeof worktree !== "string" || !worktree) return { root: null, repo: null }
  const root = path.resolve(worktree)
  if (root === path.parse(root).root) return { root: null, repo: null }
  return { root, repo: mainWorktreeOf(root) ?? root }
}

// The context-window figure from an assistant message's tokens: input + cache, as OpenCode
// counts its own context (`input` already excludes the cache). The event carries no window,
// so it is the estimate every writer shares: 200 000, or 1 000 000 past that. null for an
// update with no tokens yet (a new message's first update), which must not reset the figure.
function contextOf(tokens) {
  const used = (tokens?.input || 0) + (tokens?.cache?.read || 0) + (tokens?.cache?.write || 0)
  return used > 0 ? { used, window: used > 200000 ? 1000000 : 200000 } : null
}

// The snapshot v2 keys: set as given (null included) whenever an event carries them.
const V2_KEYS = ["root", "repo", "agents", "turns", "context", "compactions", "compacted_at", "context_at_compaction"]

// Pure reducer: prev entry (or null) + an extracted event → next entry, or null to
// delete the file. The hook does the IO + derivation; this just merges. Truthy-set
// fields (title/cwd/agent/model) only overwrite when provided; clearable fields
// (phase/turn_started_at/error/blocked_on) use `in` so null can reset them.
function applyEvent(prev, ev) {
  if (ev.type === "session.deleted") return null
  const next = prev
    ? { ...prev }
    : { session_id: ev.sid, agent: null, title: null, cwd: null, status: "idle", pid: ev.pid }
  next.updated_at = ev.nowSec
  if (ev.title != null) next.title = ev.title || null
  if (ev.cwd) next.cwd = ev.cwd
  if (ev.agent) next.agent = ev.agent
  if (ev.model) next.model = ev.model
  if (ev.cost != null) next.cost = ev.cost
  if (ev.tokens != null) next.tokens = ev.tokens
  if (ev.files !== undefined) next.files = ev.files
  if (ev.todos !== undefined) next.todos = ev.todos
  if ("phase" in ev) next.phase = ev.phase
  if ("turn_started_at" in ev) next.turn_started_at = ev.turn_started_at
  if ("error" in ev) next.error = ev.error
  if ("blocked_on" in ev) next.blocked_on = ev.blocked_on
  for (const k of V2_KEYS) if (k in ev) next[k] = ev[k]
  const st = ev.status || nextStatus(ev.type, ev.statusType)
  if (st) next.status = st
  return next
}

function safeName(sid) {
  return String(sid).replace(/[^A-Za-z0-9_.-]/g, "_")
}

// One-line snippet for a transcript/timeline text record (no full prose persisted).
// Conversation prompts/replies pass a longer cap so the question stays readable.
const snip = (s, n = SNIPPET_LEN) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n)
const CONV_LEN = 240

// --- IO ----------------------------------------------------------------------

// Atomic write: tmp + rename so the reader never sees a half-written file.
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${PID}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(obj))
  fs.renameSync(tmp, file)
}

const entryPath = (sid) => path.join(activityDir(), `${safeName(sid)}.json`)
// Detail file (v1.2): full files/todos + the step timeline. Named *.detail.json so
// the list glob (which skips that suffix) never mistakes it for a session snapshot.
const detailPath = (sid) => path.join(activityDir(), `${safeName(sid)}.detail.json`)

function writeEntry(entry) { writeJson(entryPath(entry.session_id), entry) }
function removeEntry(sid) { try { fs.unlinkSync(entryPath(sid)) } catch {} }
function removeDetail(sid) { try { fs.unlinkSync(detailPath(sid)) } catch {} }

// --- plugin ------------------------------------------------------------------

export const GeneseedActivity = async (input) => {
  const { root, repo } = rootsOf(input?.worktree)   // once: one OpenCode instance, one worktree
  const owned = new Map()    // sid -> entry (top-level sessions this process tracks)
  const skipped = new Set()  // sid -> geneseed throwaway / orphan child, ignored from here on
  const childOf = new Map()  // child sid -> the owned root session it is a sub-agent of
  const agentRows = new Map() // owned sid -> Map(child sid -> {id, type, status, started})
  const launchedIn = new Map() // child sid -> its root session's user-message id at launch (see ownRowsDeduped)
  const accts = new Map()    // sid -> Map(messageId -> {cost,tokens}) — token/cost accumulation
  const pending = new Map()  // sid -> Set(permissionId) — open permission prompts (→ blocked)
  const timelines = new Map() // sid -> Map(key -> step record) — the v1.2 detail ring (insertion-ordered)
  const details = new Map()  // sid -> { files, todos, lastMs } — uncapped lists + flush throttle

  const acctFor = (sid) => { let m = accts.get(sid); if (!m) { m = new Map(); accts.set(sid, m) } return m }
  const pendingFor = (sid) => { let s = pending.get(sid); if (!s) { s = new Set(); pending.set(sid, s) } return s }
  const tlFor = (sid) => { let m = timelines.get(sid); if (!m) { m = new Map(); timelines.set(sid, m) } return m }
  // convo: an ordered Map(messageId -> {role,text,t}) — one bounded turn per message,
  // keyed by message id so a streaming assistant turn updates in place (not per delta).
  const detFor = (sid) => {
    let d = details.get(sid)
    if (!d) { d = { files: null, todos: null, lastMs: 0, convo: new Map(), turnDiffs: new Map(), wideDiff: null, turnIds: new Set(), lastUser: null }; details.set(sid, d) }
    return d
  }
  // The session's latest user-message id (ids ascend; an older message can re-fire later).
  const sawUser = (sid, id) => {
    const d = detFor(sid)
    if (id && (!d.lastUser || id > d.lastUser)) d.lastUser = id
  }
  // Files touched + churn. Where each OpenCode version puts them (session/summary.ts):
  // - 1.19.x: only on the USER message, `summary.diffs`, recomputed after every step of
  //   that turn from its first step-start to its latest step-finish snapshot. The session
  //   summary is zeroed and session.diff sent empty on every step.
  // - 1.3.x: the same per-turn diffs, plus a session-wide list on session.diff.
  // So the per-turn diffs are the one source, keyed by user message id like acctTotals:
  // the same id replaces (the turn grew), a new id adds per file (a new turn, a new
  // baseline). A session-wide list (session.diff, or a session summary carrying diffs) is
  // only the fallback while no turn has reported: two sources would make the card flicker,
  // and 1.19's revert sends a session.diff that holds the range about to be undone.
  // A sub-agent's turns land in its root session's map with `by` = the child id (message ids
  // are unique across sessions). V2 has no turn diff: each step's files ride a synthetic
  // per-step list (toV1Events), keyed the same way.
  // shortcut: summarize is forked upstream, so an older recompute can land after a newer
  // one and replace it; fine for a live card, upgrade if a turn's numbers must be exact.
  const setFiles = (sid, ev) => {
    const d = detFor(sid)
    const files = foldDiffs(d.turnDiffs.size ? ownRowsDeduped(d.turnDiffs, launchedIn) : [d.wideDiff ?? []])
    ev.files = { ...files, items: files.items.slice(0, FILE_CAP) }   // card: capped
    d.files = files                                                 // detail: uncapped
  }
  const wideDiff = (sid, list) => {
    if (!Array.isArray(list) || !owned.has(sid)) return false
    detFor(sid).wideDiff = list.map((d) => slimDiff(d, null, root))
    return !detFor(sid).turnDiffs.size   // write only when it is the source in force
  }
  // A turn's diff list (user message `id` of session `owner`; `by` the child that ran it).
  const turnDiff = (owner, id, list, by) => {
    detFor(owner).turnDiffs.set(id, list.map((d) => slimDiff(d, by, root)))
  }
  const agentsOf = (sid) => { let m = agentRows.get(sid); if (!m) { m = new Map(); agentRows.set(sid, m) } return m }
  // Create or update a sub-agent row of `owner`; writes only on a change.
  const setAgent = (owner, id, patch) => {
    const m = agentsOf(owner)
    const prev = m.get(id)
    const row = { ...(prev ?? { id, type: null, status: "running", started: Math.floor(Date.now() / 1000) }), ...patch }
    if (prev && prev.status === row.status && prev.type === row.type) return
    m.set(id, row)
    persist(owner, { type: "agent", agents: [...m.values()] })
    flushDetail(owner, true)
  }
  const forget = (sid) => {
    owned.delete(sid); accts.delete(sid); pending.delete(sid); timelines.delete(sid); details.delete(sid)
    agentRows.delete(sid)
    for (const [child, owner] of childOf) if (owner === sid) { childOf.delete(child); launchedIn.delete(child) }
    removeEntry(sid); removeDetail(sid)
  }

  // Push a step into the ring; the same key (callID / part id) updates in place so a
  // streaming part doesn't flood, and the ring is capped to the most recent LOG_CAP.
  const pushStep = (sid, key, rec) => {
    const m = tlFor(sid)
    m.set(key, rec)
    while (m.size > LOG_CAP) m.delete(m.keys().next().value)
  }
  // Record a conversation turn (user prompt or assistant reply), keyed by message id so
  // a streaming assistant turn updates in place. Capped to the most recent CONV_CAP.
  let userSeq = 0
  const pushTurn = (sid, key, role, text) => {
    const c = detFor(sid).convo
    c.set(key || `u${userSeq++}`, { role, text: snip(text, CONV_LEN), t: Date.now() })
    while (c.size > CONV_CAP) c.delete(c.keys().next().value)
  }
  // Rewrite the detail file (uncapped files/todos + timeline). Throttled per session —
  // a text-streaming turn updates the ring in memory but only flushes ~1/700ms, except
  // on `force` (tool end / step / subtask / idle / error) which flushes immediately.
  const flushDetail = (sid, force) => {
    try {
      const d = detFor(sid)
      const now = Date.now()
      if (!force && now - d.lastMs < DETAIL_THROTTLE_MS) return
      d.lastMs = now
      writeJson(detailPath(sid), { files: d.files, todos: d.todos, agents: [...agentsOf(sid).values()], conversation: [...d.convo.values()], timeline: [...tlFor(sid).values()] })
    } catch (err) { log(`detail ${sid} failed: ${err?.message ?? err}`) }
  }
  // Record a message part into the timeline. Returns true when it should force a flush.
  const recordPart = (sid, part) => {
    const t = Date.now()
    switch (part.type) {
      case "tool": {
        const s = part.state ?? {}
        pushStep(sid, `tool:${part.callID}`, {
          t, kind: "tool", label: s.title || part.tool || "tool", tool: part.tool, status: s.status,
          ms: s.time?.end && s.time?.start ? s.time.end - s.time.start : undefined,
          error: s.status === "error" ? errStr(s.error) : undefined,
        })
        return s.status === "completed" || s.status === "error"
      }
      case "reasoning": pushStep(sid, part.id, { t, kind: "thinking", snippet: snip(part.text) }); return false
      case "text":
        // Streaming assistant text — a timeline step AND an assistant turn in the
        // conversation (keyed by message id so the streaming turn updates in place).
        pushStep(sid, part.id, { t, kind: "text", snippet: snip(part.text) })
        pushTurn(sid, part.messageID, "assistant", part.text)
        return false
      case "subtask": pushStep(sid, part.id, { t, kind: "subtask", agent: part.agent, label: part.description }); return true
      case "step-finish": pushStep(sid, part.id, { t, kind: "step", reason: part.reason, cost: part.cost, tokens: (part.tokens?.input || 0) + (part.tokens?.output || 0) }); return true
      case "retry": pushStep(sid, part.id, { t, kind: "retry", label: `retry #${part.attempt}` }); return true
      default: return false
    }
  }

  const isThrowaway = (title) => typeof title === "string" && title.startsWith("geneseed-")

  // A sub-agent's events, routed to its root session `owner`. Only what the parent's card
  // shows is read: the child's busy/idle (its branch's status — not the parent's `task` part,
  // which with background=true completes while the child still runs) and its turn diffs.
  const onChild = (event, props, sid, owner) => {
    if (!owned.has(owner)) return
    switch (event.type) {
      case "session.status":
        setAgent(owner, sid, { status: props.status?.type === "idle" ? "done" : "running" })
        return
      case "session.idle":
      case "session.deleted":
        setAgent(owner, sid, { status: "done" })
        if (event.type === "session.deleted") childOf.delete(sid)
        return
      case "message.updated": {
        const info = props.info ?? {}
        if (info.role !== "user" || !info.id || !Array.isArray(info.summary?.diffs)) return
        turnDiff(owner, info.id, info.summary.diffs, sid)
        const ev = { type: "child.diff" }
        setFiles(owner, ev)
        persist(owner, ev)
        flushDetail(owner, true)
        return
      }
      case "message.removed": {
        if (!detFor(owner).turnDiffs.delete(props.messageID)) return
        const ev = { type: "child.diff" }
        setFiles(owner, ev)
        persist(owner, ev)
        flushDetail(owner, true)
        return
      }
      default:
        return
    }
  }

  const persist = (sid, ev) => {
    try {
      const next = applyEvent(owned.get(sid) || null, {
        ...ev, sid, pid: PID, nowSec: Math.floor(Date.now() / 1000),
      })
      if (next === null) { forget(sid); return }
      owned.set(sid, next)
      writeEntry(next)
    } catch (err) {
      log(`persist ${sid} failed: ${err?.message ?? err}`)
    }
  }

  return {
    event: async ({ event }) => {
      if (!event) return
      // Runtime toggle: when disabled, stop writing and clear any files we already
      // own (so the dir empties out), then no-op until re-enabled.
      if (!isEnabled()) {
        if (owned.size) { for (const sid of [...owned.keys()]) forget(sid) }
        return
      }
      const props = event.properties ?? event.payload ?? {}
      const sid = sidOf(props)
      if (!sid || skipped.has(sid)) return
      const owner = childOf.get(sid)
      if (owner) { onChild(event, props, sid, owner); return }

      switch (event.type) {
        case "session.created":
        case "session.updated": {
          const info = props.info ?? {}
          // A geneseed-* distil session is background machinery — drop it (and any file we
          // already wrote when its title was still blank).
          if (isThrowaway(info.title)) {
            skipped.add(sid)
            if (owned.has(sid)) forget(sid)
            return
          }
          // A child session is a sub-agent of the root session its parent belongs to; one
          // whose parent this process does not track has nowhere to go.
          const parentID = info.parentID ?? info.parentId
          if (parentID) {
            const top = childOf.get(parentID) ?? (owned.has(parentID) ? parentID : null)
            if (!top) { skipped.add(sid); return }
            childOf.set(sid, top)
            launchedIn.set(sid, detFor(top).lastUser)
            setAgent(top, sid, { type: info.agent || null, status: "running",
              started: Math.floor((info.time?.created || Date.now()) / 1000) })
            return
          }
          if (event.type !== "session.created" && !owned.has(sid)) return
          const ev = { type: event.type, title: info.title ?? null, cwd: info.directory }
          if (!owned.has(sid)) Object.assign(ev, { root, repo, agents: [], turns: 0, context: null,
            compactions: 0, compacted_at: null, context_at_compaction: null })
          // A session summary is a files source only when it carries diffs (see setFiles):
          // 1.19 sends it zeroed on every step, which must not wipe the card.
          const wide = wideDiff(sid, info.summary?.diffs)
          if (wide) setFiles(sid, ev)
          persist(sid, ev)
          if (wide) flushDetail(sid, true)
          return
        }
        case "session.diff":
          if (wideDiff(sid, props.diff)) {
            const ev = { type: event.type }
            setFiles(sid, ev)
            persist(sid, ev)
            flushDetail(sid, true)
          }
          return
        case "session.deleted":
          forget(sid)
          return
        case "session.idle":
          // Turn finished — stop the elapsed clock and clear the live phase.
          if (owned.has(sid)) { persist(sid, { type: event.type, phase: null, turn_started_at: null }); flushDetail(sid, true) }
          return
        case "session.status": {
          if (!owned.has(sid)) return
          const st = props.status?.type
          const ev = { type: event.type, statusType: st }
          if (st === "idle") { ev.phase = null; ev.turn_started_at = null }
          else if (st === "retry") ev.phase = "Retrying…"
          persist(sid, ev)
          return
        }
        case "message.updated": {
          if (!owned.has(sid)) return
          const info = props.info ?? {}
          if (info.role !== "assistant") {   // user msg → bump busy, and fold its turn's diffs
            const ev = { type: event.type }
            if (info.role === "user") sawUser(sid, info.id)
            const diffs = info.summary?.diffs
            // No diffs array (the message as first created) leaves the turn as it was;
            // an empty one is real: that turn has changed nothing so far.
            if (info.role === "user" && info.id && Array.isArray(diffs)) {
              turnDiff(sid, info.id, diffs, null)
              setFiles(sid, ev)
            }
            persist(sid, ev)
            if (ev.files) flushDetail(sid, true)
            return
          }
          const m = acctFor(sid)
          const isNewTurn = !m.has(info.id)
          const totals = acctTotals(m, info.id,
            info.cost, (info.tokens?.input || 0) + (info.tokens?.output || 0))
          const ev = {
            type: event.type,
            agent: info.mode, cwd: info.path?.cwd, model: info.modelID,
            cost: totals.cost, tokens: totals.tokens,
            // Elapsed ticks from the current assistant turn's start; cleared on completion.
            turn_started_at: info.time?.completed ? null
              : (info.time?.created ? Math.floor(info.time.created / 1000) : null),
          }
          if (info.error) ev.error = errStr(info.error)
          else if (isNewTurn) ev.error = null   // a fresh turn clears a stale error
          // The compaction summary's input is the conversation it replaces, not the context now.
          const context = info.summary ? null : contextOf(info.tokens)
          if (context) ev.context = context
          persist(sid, ev)
          return
        }
        case "session.compacted": {
          // Counted, stamped, and the context it cut from kept; the context now is unknown until
          // the next assistant message. No status: a compaction runs inside a busy turn and must
          // not show the session idle.
          const prev = owned.get(sid)
          if (!prev) return
          persist(sid, { type: event.type, context: null, compactions: (prev.compactions || 0) + 1,
            compacted_at: Math.floor(Date.now() / 1000), context_at_compaction: prev.context?.used ?? null })
          return
        }
        case "message.removed": {
          // /undo: SessionRevert.cleanup removes each reverted message, so its turn's
          // diffs must leave the totals with it.
          if (!owned.has(sid) || !detFor(sid).turnDiffs.delete(props.messageID)) return
          const ev = { type: event.type }
          setFiles(sid, ev)
          persist(sid, ev)
          flushDetail(sid, true)
          return
        }
        case "message.part.updated": {
          if (!owned.has(sid)) return
          const part = props.part ?? {}
          const ev = { type: event.type }   // any part → busy + bump
          if (part.type === "tool") {
            const ts = part.state ?? {}
            if (ts.status === "running") ev.phase = ts.title || part.tool || "working"
            else if (ts.status === "error") ev.error = errStr(ts.error)
          } else if (part.type === "reasoning") {
            ev.phase = "Thinking"
          }
          persist(sid, ev)
          flushDetail(sid, recordPart(sid, part))   // v1.2: record the step; force-flush on completion
          return
        }
        case "todo.updated": {
          if (!owned.has(sid)) return
          const todos = props.todos || []
          const counts = { done: todos.filter((t) => t.status === "completed").length, total: todos.length }
          const items = todos.map((t) => ({ content: t.content, status: t.status }))
          persist(sid, { type: event.type, todos: { ...counts, items: items.slice(0, TODO_CAP) } })  // card: capped
          detFor(sid).todos = { ...counts, items }                                                   // detail: uncapped
          flushDetail(sid, true)
          return
        }
        case "permission.updated": {
          if (!owned.has(sid)) return
          pendingFor(sid).add(props.id)
          persist(sid, { type: event.type, status: "blocked", blocked_on: props.title || props.type || "permission" })
          return
        }
        case "permission.replied": {
          if (!owned.has(sid)) return
          const p = pendingFor(sid); p.delete(props.permissionID)
          persist(sid, { type: event.type, status: p.size ? "blocked" : "busy", blocked_on: p.size ? undefined : null })
          return
        }
        case "session.error": {
          if (!owned.has(sid)) return
          const msg = errStr(props.error)
          persist(sid, { type: event.type, error: msg })
          pushStep(sid, `err:${Date.now()}`, { t: Date.now(), kind: "error", label: msg })
          flushDetail(sid, true)
          return
        }
        default:
          return
      }
    },

    // Capture each user prompt as a conversation turn — the purpose-built signal for
    // "a user message arrived with its text". Assistant replies come from the streaming
    // text parts above; together they form the full transcript. Toggle-gated.
    "chat.message": async (input, output) => {
      try {
        if (!isEnabled()) return
        const sid = input?.sessionID
        if (!sid || skipped.has(sid) || !owned.has(sid)) return
        const parts = output?.parts || []
        const id = output?.message?.id ?? input.messageID
        sawUser(sid, id)
        // `turns`: one per user prompt. chat.message fires once per prompt; the same id seen
        // twice is one turn, and a prompt without an id still counts. A prompt made only of
        // synthetic parts is not the user's: a background task hands its result back that way
        // (v1.19.4 TaskTool.injectBackgroundResult).
        if (!(parts.length && parts.every((p) => p?.synthetic))) {
          const ids = detFor(sid).turnIds
          const n = ids.size
          ids.add(id ?? Symbol("prompt"))
          if (ids.size !== n) persist(sid, { type: "chat.message", turns: ids.size })
        }
        const text = parts.filter((p) => p?.type === "text" && p.text).map((p) => p.text).join(" ").trim()
        if (!text) return
        pushTurn(sid, input.messageID, "user", text)
        flushDetail(sid, true)
      } catch (err) {
        log(`chat.message ${input?.sessionID} failed: ${err?.message ?? err}`)
      }
    },
  }
}

// ponytail: OpenCode treats every export as a plugin and rejects non-functions; hang
// the test helpers off the factory instead — reachable via import, invisible to the loader.
Object.assign(GeneseedActivity, { sidOf, nextStatus, applyEvent, acctTotals, foldDiffs, errStr, snip, safeName, activityDir, enabledFromFlag, toV1Events })

// --- OpenCode 2 --------------------------------------------------------------
// `export default { id, server, setup }` serves V1 (>= 1.3.4) and V2 from one file — why, and
// each V1 hook's V2 counterpart: adapters/opencode/HOW-OPENCODE-LOADS.md.
//
// V2's event stream is a different vocabulary (`{ type, created, data }`, the turn as an
// execution, a message as steps, tool calls as called/success/failed), but every fact the
// cards show is still in it. Rather than a second reducer, `toV1Events` translates each
// V2 event into the V1 event(s) the handler above already reduces, so both majors write
// the same files. Files touched come from each step's `files` (RelativePath[], no line
// counts), carried as a synthetic per-step user-message diff list so they fold like V1's turn
// diffs, a sub-agent's included. Not carried: todos (V2 publishes no todo event), line counts
// (null), and a revert (the session.revert.* events are not read, so the list never shrinks).

// A V2 SessionError ({ type, message }) in the V1 error union errStr reads.
const v1Error = (e) => (e ? { name: e.type, data: { message: e.message || e.type } } : undefined)

// V2 event -> the V1 events it means ([] for one the cards ignore). `tools` remembers each
// running call's name and start (callID -> { name, start }) so its end can say both.
// Pure but for `tools`; exported for tests.
function toV1Events(ev, tools) {
  const d = ev?.data ?? {}
  const sessionID = d.sessionID
  if (!sessionID) return []
  const t = typeof ev.created === "number" ? ev.created : Date.now()
  const msg = (info) => ({ type: "message.updated", properties: { info: { role: "assistant", sessionID, ...info } } })
  const part = (p) => ({ type: "message.part.updated", properties: { part: { sessionID, ...p } } })
  const stepFiles = () => (Array.isArray(d.files) ? [{ type: "message.updated", properties: { info: {
    role: "user", sessionID, id: `files:${d.assistantMessageID}`,
    summary: { diffs: d.files.map((file) => ({ file, additions: null, deletions: null })) } } } }] : [])
  switch (ev.type) {
    case "session.created":
      return [{ type: "session.created", properties: { info: {
        id: sessionID, title: d.title, parentID: d.parentID, agent: d.agent, directory: d.location?.directory } } }]
    case "session.compaction.ended":
      return [{ type: "session.compacted", properties: { sessionID } }]
    case "session.renamed":
      return [{ type: "session.updated", properties: { info: { id: sessionID, title: d.title } } }]
    case "session.deleted":
      return [{ type: "session.deleted", properties: { sessionID } }]
    case "session.execution.started":
      return [{ type: "session.status", properties: { sessionID, status: { type: "busy" } } }]
    case "session.execution.succeeded":
      return [{ type: "session.idle", properties: { sessionID } }]
    case "session.execution.failed":
      return [{ type: "session.error", properties: { sessionID, error: v1Error(d.error) } },
        { type: "session.idle", properties: { sessionID } }]
    case "session.execution.interrupted":
      return [{ type: "session.status", properties: { sessionID, status: { type: "idle" } } }]
    case "session.retry.scheduled":
      return [{ type: "session.status", properties: { sessionID, status: { type: "retry" } } }]
    case "session.step.started":
      return [msg({ id: d.assistantMessageID, mode: d.agent, modelID: d.model?.id, time: { created: t } })]
    case "session.step.ended":
      return [msg({ id: d.assistantMessageID, cost: d.cost, tokens: d.tokens, time: { completed: t } }), ...stepFiles()]
    case "session.step.failed":
      return [msg({ id: d.assistantMessageID, cost: d.cost, tokens: d.tokens, error: v1Error(d.error), time: { completed: t } }), ...stepFiles()]
    // The name rides only on `input.started`; `called` carries the input but no name.
    case "session.tool.input.started":
      tools.set(d.id, { name: d.name, start: undefined })
      return []
    case "session.tool.called": {
      const name = tools.get(d.id)?.name ?? "tool"
      tools.set(d.id, { name, start: t })
      return [part({ type: "tool", callID: d.id, tool: name, messageID: d.assistantMessageID,
        state: { status: "running", title: name, time: { start: t } } })]
    }
    case "session.tool.success":
    case "session.tool.failed": {
      const call = tools.get(d.id) ?? { name: "tool", start: undefined }
      tools.delete(d.id)
      const failed = ev.type === "session.tool.failed"
      return [part({ type: "tool", callID: d.id, tool: call.name, messageID: d.assistantMessageID,
        state: { status: failed ? "error" : "completed", title: call.name,
          error: failed ? d.error?.message || d.error?.type : undefined, time: { start: call.start, end: t } } })]
    }
    case "session.reasoning.started":
    case "session.reasoning.ended":
      return [part({ type: "reasoning", id: `r:${d.assistantMessageID}:${d.ordinal}`, text: d.text ?? "" })]
    case "session.text.ended":
      return [part({ type: "text", id: `t:${d.assistantMessageID}:${d.ordinal}`, messageID: d.assistantMessageID, text: d.text })]
    case "permission.asked":
      return [{ type: "permission.updated", properties: { sessionID, id: d.id, title: d.message || d.action } }]
    case "permission.replied":
      return [{ type: "permission.replied", properties: { sessionID, permissionID: d.requestID } }]
    default:
      return []
  }
}

async function setupV2(ctx) {
  // V2 passes no worktree path (ctx.worktree is the worktree API), so the root is the
  // checkout's top level above the instance directory, read off disk like V1's input. Step
  // files are relative to the same tree (core snapshot.ts: git.repo.discover on
  // location.project.directory, which project.ts resolves from the nearest `.git` above the
  // directory), but OpenCode takes its realPath: through a symlinked path the two spellings
  // of the root differ, while the relative file paths do not.
  const hooks = await GeneseedActivity({ worktree: gitRootOf(ctx?.location?.directory) })
  const tools = new Map()
  // The user's prompt, as V1's chat.message hook received it.
  await ctx.session.hook("prompt", async (event) => {
    try {
      await hooks["chat.message"]({ sessionID: event?.sessionID, messageID: event?.messageID },
        { parts: [{ type: "text", text: event?.prompt?.text }] })
    } catch (err) { log(`prompt hook failed: ${err?.message ?? err}`) }
  })
  const controller = new AbortController()
  void (async () => {
    for await (const ev of ctx.event.subscribe({ signal: controller.signal })) {
      for (const event of toV1Events(ev, tools)) {
        try { await hooks.event({ event }) } catch (err) { log(`event ${event.type} failed: ${err?.message ?? err}`) }
      }
    }
  })().catch((err) => log(`event stream ended: ${err?.message ?? err}`))
  return () => controller.abort()
}

export default { id: "geneseed-activity", server: GeneseedActivity, setup: setupV2 }
