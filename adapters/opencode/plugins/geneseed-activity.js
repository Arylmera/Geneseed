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
// v1 is FLAT: one entry per top-level session. Sub-agent fan-out (subtask parts,
// parent→children tree) is deferred — child sessions (those with a parentID) and the
// learn plugin's throwaway `geneseed-*` distil sessions are skipped entirely.
//
// GENESEED_ACTIVITY=off disables it. GENESEED_DEBUG=1 logs writes. Every failure is
// swallowed — it never blocks a session. See docs/specs/2026-06-15-live-activity-surface.md.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const OFF = ["off", "0", "false", "no"].includes((process.env.GENESEED_ACTIVITY || "on").toLowerCase())
const DEBUG = !!process.env.GENESEED_DEBUG
const PID = process.pid
function log(msg) { if (DEBUG) console.error(`[geneseed-activity] ${msg}`) }

// The activity dir, resolved to EXACTLY match the Python reader's
// build._opencode_config_dir() precedence ($OPENCODE_CONFIG_DIR > $XDG_CONFIG_HOME/
// opencode > ~/.config/opencode). Copying geneseed-ponytail's statePath() verbatim
// would check XDG only and diverge from the reader whenever $OPENCODE_CONFIG_DIR is
// set — the one path-divergence bug this seam exists to avoid.
function activityDir() {
  const base =
    process.env.OPENCODE_CONFIG_DIR ||
    path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode")
  return path.join(base, "activity")
}

// --- pure helpers (exported for tests) ---------------------------------------

// Session id from an event's properties, across the shapes OpenCode uses:
// session.status carries `sessionID`; message.updated's `info` (a Message) carries
// `sessionID`; message.part.updated's `part` carries `sessionID`; session.* carry
// `info` (a Session) whose own id is `id`.
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

// Pure reducer: prev entry (or null) + an extracted event → next entry, or null to
// delete the file. The hook does the IO (read meta, write/unlink); this is the logic.
function applyEvent(prev, ev) {
  if (ev.type === "session.deleted") return null
  const next = prev
    ? { ...prev }
    : { session_id: ev.sid, agent: null, title: null, cwd: null, status: "idle", pid: ev.pid }
  next.updated_at = ev.nowSec
  if (ev.title != null) next.title = ev.title || null
  if (ev.cwd) next.cwd = ev.cwd
  if (ev.agent) next.agent = ev.agent
  const st = nextStatus(ev.type, ev.statusType)
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

  const isThrowaway = (title, parentID) =>
    !!parentID || (typeof title === "string" && title.startsWith("geneseed-"))

  const persist = (sid, ev) => {
    try {
      const next = applyEvent(owned.get(sid) || null, {
        ...ev, sid, pid: PID, nowSec: Math.floor(Date.now() / 1000),
      })
      if (next === null) { owned.delete(sid); removeEntry(sid); return }
      owned.set(sid, next)
      writeEntry(next)
    } catch (err) {
      log(`persist ${sid} failed: ${err?.message ?? err}`)
    }
  }

  return {
    event: async ({ event }) => {
      if (OFF || !event) return
      const props = event.properties ?? event.payload ?? {}
      const sid = sidOf(props)
      if (!sid || skipped.has(sid)) return

      switch (event.type) {
        case "session.created":
        case "session.updated": {
          const info = props.info ?? {}
          // A child/subagent session or a geneseed-* distil session is background
          // machinery — drop it (and any file we already wrote when its title was
          // still blank). Sub-agent fan-out is the deferred v2 tree.
          if (isThrowaway(info.title, info.parentID ?? info.parentId)) {
            skipped.add(sid)
            if (owned.has(sid)) { owned.delete(sid); removeEntry(sid) }
            return
          }
          if (event.type === "session.created" || owned.has(sid))
            persist(sid, { type: event.type, title: info.title ?? null, cwd: info.directory })
          return
        }
        case "session.deleted":
          owned.delete(sid); removeEntry(sid)
          return
        case "session.idle":
          if (owned.has(sid)) persist(sid, { type: event.type })
          return
        case "session.status":
          if (owned.has(sid)) persist(sid, { type: event.type, statusType: props.status?.type })
          return
        case "message.updated": {
          if (!owned.has(sid)) return
          // The running agent's name + cwd live on the AssistantMessage only.
          const info = props.info ?? {}
          const asst = info.role === "assistant"
          persist(sid, { type: event.type, agent: asst ? info.mode : undefined, cwd: asst ? info.path?.cwd : undefined })
          return
        }
        case "message.part.updated":
          if (owned.has(sid)) persist(sid, { type: event.type })   // streaming → busy + bump
          return
        default:
          return
      }
    },
  }
}

// ponytail: OpenCode treats every export as a plugin and rejects non-functions; hang
// the test helpers off the factory instead — reachable via import, invisible to the loader.
Object.assign(GeneseedActivity, { sidOf, nextStatus, applyEvent, safeName, activityDir })

export default GeneseedActivity
