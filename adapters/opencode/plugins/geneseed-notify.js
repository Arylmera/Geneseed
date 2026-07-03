// Geneseed — OpenCode desktop-notification plugin.
//
// Pings the OS when the agent finishes a turn, so you can walk away from a long run
// and be called back when it is your move again. Hooks OpenCode's `session.idle`
// event (fired when the assistant goes quiet) the same "act, don't just instruct"
// way the other plugins hook their events.
//
// ANTI-SPAM: it only fires when the turn actually took a while — the gap between the
// session's last user prompt and now must exceed GENESEED_NOTIFY_MIN_SECONDS
// (default 30). A two-second back-and-forth never notifies; a five-minute build or
// test run does. Native subagent child sessions and the learn plugin's throwaway
// `geneseed-*` distil sessions are skipped, so background machinery stays silent.
//
// GENESEED_NOTIFY=off               disable entirely.
// GENESEED_NOTIFY_MIN_SECONDS=N     minimum turn length, in seconds, to notify (default 30; 0 = always).
// GENESEED_NOTIFY_TITLE="…"         override the notification title (default "Geneseed").
// GENESEED_DEBUG=1                  log decisions/delivery to stderr.
//
// DELIVERY is native and dependency-free — no npm package, nothing to install:
//   macOS   → `osascript` (always present)
//   Linux   → `notify-send` (from libnotify; absent → swallowed, no error)
//   Windows → PowerShell balloon tip (System.Windows.Forms.NotifyIcon)
// The notifier is spawned detached and unref'd; a missing binary or any failure is
// swallowed, so it never blocks, delays, or breaks a session.
//
// Install: dropped into the plugins dir by `build --emit opencode[-global]` (the *.js
// glob), exactly like the context, learn, guard, and workflow plugins.

import { spawn } from "node:child_process"

const MODE = (process.env.GENESEED_NOTIFY || "on").toLowerCase()
const OFF = ["off", "0", "false", "no"].includes(MODE)
// NaN-safe: Math.max(0, NaN) is NaN, and `elapsed >= NaN` is always false — garbage
// in the env var would silently disable every notification.
const _minRaw = Number(process.env.GENESEED_NOTIFY_MIN_SECONDS ?? 30)
const MIN_MS = Math.max(0, Number.isFinite(_minRaw) ? _minRaw : 30) * 1000
const TITLE = process.env.GENESEED_NOTIFY_TITLE || "Geneseed"
const DEBUG = !!process.env.GENESEED_DEBUG
function log(msg) { if (DEBUG) console.error(`[geneseed-notify] ${msg}`) }

// The timestamp (ms) of the latest user prompt in a transcript — our proxy for "when
// this turn started", so we can measure how long the agent worked. Tolerant of the
// few shapes `info.time` takes across SDK versions. Exported for tests.
function lastUserMs(messages) {
  if (!Array.isArray(messages)) return null
  let t = null
  for (const m of messages) {
    const info = m?.info ?? {}
    if (info.role !== "user") continue
    const created = info?.time?.created ?? info?.time ?? info?.created
    if (typeof created === "number") t = created
  }
  return t
}

// Pure gate: notify only for a real, top-level, long-enough turn. Exported for tests.
//   - a subagent child session (has a parent) is background work → no.
//   - a `geneseed-*` session is the learn plugin's throwaway distil → no.
//   - unknown turn length → yes (don't suppress an opt-in ping over a missing field).
//   - otherwise: only if the turn ran at least `minMs`.
function shouldNotify({ now, lastUserMs, parentID, title, minMs }) {
  if (parentID) return false
  if (typeof title === "string" && title.startsWith("geneseed-")) return false
  if (lastUserMs == null) return true
  return now - lastUserMs >= minMs
}

// AppleScript double-quoted string literal.
function asStr(s) { return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"' }
// PowerShell single-quoted string literal (escape ' by doubling).
function psStr(s) { return "'" + String(s).replace(/'/g, "''") + "'" }

function spawnDetached(cmd, args) {
  const child = spawn(cmd, args, { stdio: "ignore", detached: true })
  child.on("error", (e) => log(`spawn ${cmd} failed: ${e?.message ?? e}`))   // e.g. notifier not installed
  child.unref()
}

// Best-effort native notification; every failure is swallowed.
function deliver(title, body) {
  try {
    if (process.platform === "darwin") {
      spawnDetached("osascript", ["-e", `display notification ${asStr(body)} with title ${asStr(title)}`])
    } else if (process.platform === "win32") {
      const script =
        "Add-Type -AssemblyName System.Windows.Forms;" +
        "Add-Type -AssemblyName System.Drawing;" +
        "$n=New-Object System.Windows.Forms.NotifyIcon;" +
        "$n.Icon=[System.Drawing.SystemIcons]::Information;$n.Visible=$true;" +
        `$n.ShowBalloonTip(5000,${psStr(title)},${psStr(body)},[System.Windows.Forms.ToolTipIcon]::Info);` +
        "Start-Sleep -Seconds 6;$n.Dispose()"
      spawnDetached("powershell", ["-NoProfile", "-NonInteractive", "-Command", script])
    } else {
      spawnDetached("notify-send", [title, body])
    }
  } catch (err) {
    log(`deliver failed: ${err?.message ?? err}`)
  }
}

export const GeneseedNotify = async ({ client }) => {
  return {
    event: async ({ event }) => {
      if (OFF || !event || event.type !== "session.idle") return
      const sid =
        event.properties?.sessionID ?? event.payload?.sessionID ??
        event.properties?.info?.id ?? event.payload?.info?.id
      if (!sid) return
      try {
        let title = "", parentID
        try {
          const info = await client.session.get?.({ path: { id: sid } })
          const meta = info?.data ?? info
          title = meta?.title ?? ""
          parentID = meta?.parentID ?? meta?.parentId
        } catch {}

        let started = null
        try {
          const res = await client.session.messages({ path: { id: sid } })
          started = lastUserMs(Array.isArray(res) ? res : res?.data ?? [])
        } catch {}

        if (!shouldNotify({ now: Date.now(), lastUserMs: started, parentID, title, minMs: MIN_MS })) {
          log(`skipped ${sid} (child/throwaway or turn under ${MIN_MS}ms)`)
          return
        }
        deliver(TITLE, title ? `Done: ${title}` : "Agent finished — your turn.")
        log(`notified for ${sid}`)
      } catch (err) {
        log(`skipped: ${err?.message ?? err}`)
      }
    },
  }
}

// ponytail: OpenCode treats every export as a plugin and rejects non-functions; a
// bare helper export crashes startup or logs "not a function". Hang the test helpers
// off the factory instead — reachable via `import`, invisible to the loader.
Object.assign(GeneseedNotify, { lastUserMs, shouldNotify })

export default GeneseedNotify
