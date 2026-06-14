import React, { useState } from 'react'
import { api } from '../../api/index.js'
import { Icon } from '../../components/Icon.jsx'

// Stops the local server from the page (same /api/shutdown that `geneseed web
// stop` uses). The connection may drop as the server goes down, so a rejected
// request right after the call is still treated as a successful stop.
export default function ServerControl() {
  const [stopped, setStopped] = useState(false)

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

  if (stopped) {
    return (
      <p className="sub">
        Server stopped. You can close this tab and reopen any time with <code>geneseed web</code>.
      </p>
    )
  }
  return (
    <button className="btn ghost" onClick={stop}>
      <Icon name="x" />
      Stop server
    </button>
  )
}
