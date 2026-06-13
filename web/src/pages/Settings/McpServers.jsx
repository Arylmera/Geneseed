import React, { useState } from 'react'
import { api } from '../../api/index.js'
import { useAsync } from '../../hooks/useAsync.js'
import Loading from '../../components/Loading.jsx'
import ErrorState from '../../components/ErrorState.jsx'

// The MCP-server wiring panel: per-target lists of servers with switches to
// enable/disable present ones and Add buttons for absent presets. Targets whose
// config carries comments are read-only (edited by hand).
export default function McpServers() {
  const { data, error, reload } = useAsync(() => api.mcp(), []) // { targets, default }
  const [note, setNote] = useState('')
  const [busyKey, setBusyKey] = useState('')

  if (error) return <ErrorState error={error} />
  if (!data) return <Loading />

  const toggle = async (target, s) => {
    const key = target.path + s.name
    setBusyKey(key)
    setNote('')
    try {
      await api.mcpToggle(target.path, s.name, s.state !== 'enabled')
      await reload()
    } catch (e) {
      setNote(e.message)
    } finally {
      setBusyKey('')
    }
  }

  return (
    <>
      {note ? <p className="badge bad">{note}</p> : null}
      {data.targets.map((t) => (
        <div className="mcp-target" key={t.path}>
          <div className="mt-head">
            {t.label} — <code>{t.path}</code>
            {t.commented && ' (has comments — edit by hand)'}
          </div>
          {t.servers.map((s) => {
            const key = t.path + s.name
            const isDisabled = !!(t.commented || busyKey === key)
            return (
              <div className="mcp-row" key={s.name}>
                <div className="mcp-info">
                  <div className="mi-top">
                    <strong>{s.label}</strong>
                    <span className={`badge ${s.state === 'enabled' ? 'ok' : ''}`}>{s.state}</span>
                  </div>
                  <p>{s.desc}</p>
                </div>
                {s.state !== 'absent' ? (
                  <div
                    className={`sw-toggle${s.state === 'enabled' ? ' on' : ''}`}
                    role="switch"
                    aria-checked={s.state === 'enabled'}
                    aria-disabled={isDisabled || undefined}
                    tabIndex={isDisabled ? -1 : 0}
                    onClick={isDisabled ? undefined : () => toggle(t, s)}
                    onKeyDown={
                      isDisabled
                        ? undefined
                        : (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              if (e.key === ' ') e.preventDefault()
                              toggle(t, s)
                            }
                          }
                    }
                  />
                ) : s.preset ? (
                  <button
                    className="btn ghost sm"
                    disabled={isDisabled}
                    onClick={() => toggle(t, s)}
                  >
                    Add
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      ))}
    </>
  )
}
