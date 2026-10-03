import React, { useState } from 'react'
import { api } from '../api/index.js'
import { RESTART_POLL_INTERVAL_MS, waitForServerThenReload } from '../hooks/waitForServer.js'

// The server started before the files on disk changed (an npm upgrade, a git pull): it still
// serves the old index.html, whose chunks may no longer exist. The overview's `daemon_stale`
// says so; Restart is the same /api/restart Settings' server control uses.
export default function StaleBanner() {
  const [restarting, setRestarting] = useState(false)
  const restart = async () => {
    setRestarting(true)
    try {
      await api.restart()
    } catch {
      // the connection drops as the old server goes down — expected
    }
    waitForServerThenReload(RESTART_POLL_INTERVAL_MS)
  }
  return (
    <div className="stale-banner" role="alert">
      <span>This console is running code from before your last upgrade.</span>
      <button className="btn sm" onClick={restart} disabled={restarting}>
        {restarting ? 'Restarting…' : 'Restart'}
      </button>
    </div>
  )
}
