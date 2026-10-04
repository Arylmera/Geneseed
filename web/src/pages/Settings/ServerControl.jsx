import React, { useState } from 'react'
import { api } from '../../api/index.js'
import { Icon } from '../../components/Icon.jsx'
import { restartAndReload } from '../../hooks/waitForServer.js'
import { useConfirm } from '../../hooks/useConfirm.jsx'

// Stops the local server from the page (same /api/shutdown that `geneseed web
// stop` uses). The connection may drop as the server goes down, so a request that
// never got an answer is still treated as a successful stop — but a REFUSAL (409
// while a job runs) is an answer, and is shown instead.
export default function ServerControl() {
  const confirm = useConfirm()
  const [stopped, setStopped] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [error, setError] = useState(null)

  const stop = async () => {
    const ok = await confirm(
      'Stop the local Geneseed server? The console goes offline until you start it again.',
      { title: 'Stop the server?', confirmLabel: 'Stop server' },
    )
    if (!ok) return
    setError(null)
    try {
      await api.shutdown()
    } catch (e) {
      // no status: the server dropped the connection while shutting down — expected
      if (e.status) return setError(e.message)
    }
    setStopped(true)
  }

  // Restart comes back on the same port; `restartAndReload` reloads once the NEW
  // server answers /api/ping, and throws if the server refused to restart.
  const restart = async () => {
    const ok = await confirm(
      'Restart the local Geneseed server? The console reconnects in a moment.',
      { title: 'Restart the server?', confirmLabel: 'Restart' },
    )
    if (!ok) return
    setRestarting(true)
    setError(null)
    try {
      await restartAndReload()
    } catch (e) {
      setError(e.message)
      setRestarting(false)
    }
  }

  if (stopped) {
    return (
      <p className="sub">
        Server stopped. You can close this tab and reopen any time with <code>geneseed web</code>.
      </p>
    )
  }
  return (
    <>
      {error && (
        <p className="sub" role="alert">
          {error}
        </p>
      )}
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
    </>
  )
}
