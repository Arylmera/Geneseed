import { api } from '../api/index.js'

// After the server restarts (an update finishing, or a manual restart), the
// connection drops for a few seconds while it comes back up. Poll /api/ping
// until A NEW SERVER answers — up to a ~30s budget — then hard-reload so the
// page picks up whatever changed (a new UI bundle, a new CSRF token).
//
// "A new server" is the point: /api/restart answers 200 at once, and the OLD
// process keeps answering pings for a moment after. Reloading on the first ping
// that succeeds landed the page back on the old server — the old index.html, the
// old token — and every mutation after the bounce then 403'd. /api/ping carries
// the server's `pid`, so the wait is for a pid other than the one asked to go.
//
// `initialDelayMs` is the one axis the callers differ on: useJobs waits 2000ms
// after an update finishes, a manual restart waits one poll interval.
export const RESTART_POLL_INTERVAL_MS = 1000
export const RESTART_MAX_TRIES = 30

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** The answering server's pid, or null while nothing answers. */
export async function serverPid() {
  try {
    return (await api.ping()).pid ?? null
  } catch {
    return null
  }
}

export async function waitForServerThenReload(initialDelayMs = 0, oldPid = null) {
  await sleep(initialDelayMs)
  for (let i = 0; i < RESTART_MAX_TRIES; i++) {
    const pid = await serverPid()
    if (pid !== null && pid !== oldPid) break
    await sleep(RESTART_POLL_INTERVAL_MS)
  }
  window.location.reload()
}

// The one restart-then-wait, shared by the stale banner and Settings' server
// control. A refusal (409: a job is running, or a foreground `geneseed web`
// that cannot restart itself) THROWS, so the caller can say why; a dropped
// connection is the old server going down, which is expected.
export async function restartAndReload() {
  const oldPid = await serverPid()
  try {
    await api.restart()
  } catch (e) {
    if (e.status) throw e
  }
  await waitForServerThenReload(RESTART_POLL_INTERVAL_MS, oldPid)
}
