// Geneseed — OpenCode live-activity writer plugin.
//
// Surfaces what the harness is DOING (not just what it is) to the web console's
// Activity view. Writes one small JSON file per session into the OpenCode config
// dir's `activity/` folder; the Python web server (rituals/_web_activity.py) globs
// and renders them. Fully decoupled: the writer never talks to the reader, only the
// filesystem — language-agnostic, crash-isolated, no RPC. Mirrors the file-IPC seam
// the other plugins already use (geneseed-ponytail's state file, geneseed-workflow's
// per-run trace shards).
//
// ONE FILE PER SESSION (`activity/<session_id>.json`), owned exclusively by the
// process that created the session — so concurrent `opencode` invocations never
// contend on a shared file and no lock is needed. Atomic write (tmp + rename) keeps
// the reader from ever seeing a torn file. The reader prunes entries whose `pid` is
// dead or whose `updated_at` is stale, so a crashed writer's file self-cleans.
//
// FLAT: one entry per top-level session. Sub-agent fan-out (subtask parts,
// parent→children tree) is deferred — child sessions (those with a parentID) and the
// learn plugin's throwaway `geneseed-*` distil sessions are skipped entirely.
//
// v1.1 enriches each entry from events/fields it already receives or one `case` away:
// the current phase (tool/thinking), model, session token+cost totals, turn-elapsed,
// files-touched + churn, the todo/plan, blocked-on-permission, and the last error.
//
// GENESEED_ACTIVITY=off disables it. GENESEED_DEBUG=1 logs writes. Every failure is
// swallowed — it never blocks a session. See docs/specs/2026-06-15-live-activity-surface.md
// and docs/specs/2026-06-18-activity-v1.1-enriched-cards.md.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// GENESEED_ACTIVITY=off is a hard kill switch at startup; the web console's runtime
// toggle is the .geneseed-activity flag file checked per event (see isEnabled).
const ENV_OFF = ["off", "0", "false", "no"].includes((process.env.GENESEED_ACTIVITY || "on").toLowerCase())
const DEBUG = !!process.env.GENESEED_DEBUG
const PID = process.pid
function log(msg) { if (DEBUG) console.error(`[geneseed-activity] ${msg}`) }

// The OpenCode config dir, resolved to EXACTLY match the Python reader's
// build._opencode_config_dir() precedence ($OPENCODE_CONFIG_DIR > $XDG_CONFIG_HOME/
// opencode > ~/.config/opencode). Copying geneseed-ponytail's statePath() verbatim
// would check XDG only and diverge from the reader whenever $OPENCODE_CONFIG_DIR is
// set — the one path-divergence bug this seam exists to avoid.
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
  const st = ev.status || nextStatus(ev.type, ev.statusType)
  if (st) next.status = st
  return next
}

function safeName(sid) {
  return String(sid).replace(/[^A-Za-z0-9_.-]/g, "_")
}

// --- IO ----------------------------------------------------------------------

function writeEntry(entry) {
  const dir = activityDir()
  const file = path.join(dir, `${safeName(entry.session_id)}.json`)
  const tmp = `${file}.${PID}.tmp`
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(entry))
  fs.renameSync(tmp, file)   // atomic: the reader never sees a half-written file
}

function removeEntry(sid) {
  try { fs.unlinkSync(path.join(activityDir(), `${safeName(sid)}.json`)) } catch {}
}

// --- plugin ------------------------------------------------------------------

export const GeneseedActivity = async () => {
  const owned = new Map()    // sid -> entry (top-level sessions this process tracks)
  const skipped = new Set()  // sid -> child / geneseed throwaway, ignored from here on
  const accts = new Map()    // sid -> Map(messageId -> {cost,tokens}) — token/cost accumulation
  const pending = new Map()  // sid -> Set(permissionId) — open permission prompts (→ blocked)

  const acctFor = (sid) => { let m = accts.get(sid); if (!m) { m = new Map(); accts.set(sid, m) } return m }
  const pendingFor = (sid) => { let s = pending.get(sid); if (!s) { s = new Set(); pending.set(sid, s) } return s }
  const forget = (sid) => { owned.delete(sid); accts.delete(sid); pending.delete(sid); removeEntry(sid) }

  const isThrowaway = (title, parentID) =>
    !!parentID || (typeof title === "string" && title.startsWith("geneseed-"))

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

      switch (event.type) {
        case "session.created":
        case "session.updated": {
          const info = props.info ?? {}
          // A child/subagent session or a geneseed-* distil session is background
          // machinery — drop it (and any file we already wrote when its title was
          // still blank). Sub-agent fan-out is the deferred tree.
          if (isThrowaway(info.title, info.parentID ?? info.parentId)) {
            skipped.add(sid)
            if (owned.has(sid)) forget(sid)
            return
          }
          if (event.type !== "session.created" && !owned.has(sid)) return
          const ev = { type: event.type, title: info.title ?? null, cwd: info.directory }
          // Files touched + churn ride the session summary (cumulative).
          const s = info.summary
          if (s) ev.files = {
            count: s.files || 0, additions: s.additions || 0, deletions: s.deletions || 0,
            items: (s.diffs || []).slice(0, FILE_CAP).map((d) => ({
              file: d.file, additions: d.additions, deletions: d.deletions,
            })),
          }
          persist(sid, ev)
          return
        }
        case "session.deleted":
          forget(sid)
          return
        case "session.idle":
          // Turn finished — stop the elapsed clock and clear the live phase.
          if (owned.has(sid)) persist(sid, { type: event.type, phase: null, turn_started_at: null })
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
          if (info.role !== "assistant") { persist(sid, { type: event.type }); return }   // user msg → bump busy
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
          persist(sid, ev)
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
          return
        }
        case "todo.updated": {
          if (!owned.has(sid)) return
          const todos = props.todos || []
          persist(sid, { type: event.type, todos: {
            done: todos.filter((t) => t.status === "completed").length,
            total: todos.length,
            items: todos.slice(0, TODO_CAP).map((t) => ({ content: t.content, status: t.status })),
          } })
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
          persist(sid, { type: event.type, error: errStr(props.error) })
          return
        }
        default:
          return
      }
    },
  }
}

// ponytail: OpenCode treats every export as a plugin and rejects non-functions; hang
// the test helpers off the factory instead — reachable via import, invisible to the loader.
Object.assign(GeneseedActivity, { sidOf, nextStatus, applyEvent, acctTotals, errStr, safeName, activityDir, enabledFromFlag })

export default GeneseedActivity
