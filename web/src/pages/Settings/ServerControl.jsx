import React, { useState } from 'react'
import { api } from '../../api/index.js'
import { Icon } from '../../components/Icon.jsx'

// Restart polling: ping the server every interval until it answers, up to a ~30s
// budget (RESTART_MAX_TRIES × RESTART_POLL_INTERVAL_MS).
const RESTART_MAX_TRIES = 30
const RESTART_POLL_INTERVAL_MS = 1000

// Stops the local server from the page (same /api/shutdown that `geneseed web
// stop` uses). The connection may drop as the server goes down, so a rejected
// request right after the call is still treated as a successful stop.
export default function ServerControl() {
  const [stopped, setStopped] = useState(false)
  const [restarting, setRestarting] = useState(false)

  const stop = async () => {
    if (
      !window.confirm(
        'Stop the local Geneseed server? The console goes offline until you start it again.',
      )
    )
      return
    try {
      await api.shutdown()
    } catch {
      // server dropped the connection while shutting down — expected
    }
    setStopped(true)
  }

  // Restart comes back on the same port, so reload once it answers /api/ping
  // again. The connection drops while it bounces — poll past the failures.
  const restart = async () => {
    if (!window.confirm('Restart the local Geneseed server? The console reconnects in a moment.'))
      return
    setRestarting(true)
    try {
      await api.restart()
    } catch {
      // connection may drop as the old server goes down — expected
    }
    const waitForServer = async (tries = RESTART_MAX_TRIES) => {
      for (let i = 0; i < tries; i++) {
        await new Promise((r) => setTimeout(r, RESTART_POLL_INTERVAL_MS))
        try {
          await api.ping()
          window.location.reload()
          return
        } catch {
          // not back up yet
        }
      }
      window.location.reload()
    }
    waitForServer()
  }

  if (stopped) {
    return (
      <p className="sub">
        Server stopped. You can close this tab and reopen any time with <code>geneseed web</code>.
      </p>
    )
  }
  return (
    <div className="row">
      <button className="btn ghost" onClick={restart} disabled={restarting}>
        <Icon name="refresh" />
        {restarting ? 'Restarting…' : 'Restart server'}
      </button>
      <button className="btn ghost" onClick={stop} disabled={restarting}>
        <Icon name="x" />
        Stop server
      </button>
    </div>
  )
}
