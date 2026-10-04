import React, { useState } from 'react'
import { restartAndReload } from '../hooks/waitForServer.js'

// The server started before the files on disk changed (an npm upgrade, a git pull): it still
// serves the old index.html, whose chunks may no longer exist. The overview's `daemon_stale`
// says so; Restart is the same /api/restart Settings' server control uses.
export default function StaleBanner() {
  const [restarting, setRestarting] = useState(false)
  const [error, setError] = useState(null)
  const restart = async () => {
    setRestarting(true)
    setError(null)
    try {
      await restartAndReload()
    } catch (e) {
      setError(e.message)
      setRestarting(false)
    }
  }
  return (
    <div className="stale-banner" role="alert">
      <span>{error || 'This console is running code from before your last upgrade.'}</span>
      <button className="btn sm" onClick={restart} disabled={restarting}>
        {restarting ? 'Restarting…' : 'Restart'}
      </button>
    </div>
  )
}
