import { api } from '../api/index.js'

// After the server restarts (an update finishing, or a manual restart), the
// connection drops for a few seconds while it comes back up. Poll /api/ping
// until it answers again — up to a ~30s budget — then hard-reload so the page
// picks up whatever changed (a new UI bundle, a new CSRF token).
//
// Shared by useJobs (post-update bounce) and ServerControl (manual restart),
// which had each written this loop separately. `initialDelayMs` is the one
// axis they differ on: useJobs waits once up front then pings immediately
// (2000ms after an update finishes, 0ms when the poller lost the server
// mid-run), where ServerControl's original loop slept before EVERY ping,
// including the first. Passing RESTART_POLL_INTERVAL_MS (1000) as the initial
// delay reproduces that exactly: sleep(1000) once, then ping-first-sleep-on-
// failure at the same 1000ms cadence is the same ping-at-elapsed-N*1000ms
// schedule as sleeping before every attempt.
export const RESTART_POLL_INTERVAL_MS = 1000
export const RESTART_MAX_TRIES = 30

export async function waitForServerThenReload(initialDelayMs = 0) {
  await new Promise((r) => setTimeout(r, initialDelayMs))
  for (let i = 0; i < RESTART_MAX_TRIES; i++) {
    try {
      await api.ping()
      break
    } catch {
      await new Promise((r) => setTimeout(r, RESTART_POLL_INTERVAL_MS))
    }
  }
  window.location.reload()
}
