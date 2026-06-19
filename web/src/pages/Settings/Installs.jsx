import React, { useState } from 'react'
import { api } from '../../api/index.js'
import { useAsync } from '../../hooks/useAsync.js'
import Loading from '../../components/Loading.jsx'
import ErrorState from '../../components/ErrorState.jsx'

// The harness-install panel: one row per detected OpenCode install (this project,
// global config) with a switch that deactivates a whole install — files moved
// aside, not deleted — and reactivates it. The on-disk stash dir is the truth;
// the switch only triggers the move and reflects the resulting state.
export default function Installs({ onAction }) {
  const { data, error } = useAsync(() => api.installs(), []) // { installs }
  const [note, setNote] = useState('')
  const [busyKey, setBusyKey] = useState('')

  if (error) return <ErrorState error={error} />
  if (!data) return <Loading />

  // Install Geneseed into a detected-but-absent location — it inherits the current
  // deployed voice. Runs as a background job streamed to the console; on finish the page
  // reloads and the row flips to active. Non-destructive — deactivate/uninstall undo it.
  const install = (inst) => {
    if (
      window.confirm(
        `Install Geneseed into ${inst.path} with the current voice? Files are added ` +
          `non-destructively (your own config is left untouched); you can deactivate or ` +
          `uninstall it later.`,
      )
    )
      onAction?.('install', { host: inst.host, scope: inst.scope, path: inst.path })
  }

  const toggle = async (inst) => {
    if (
      inst.state === 'active' &&
      !window.confirm(
        'Deactivate this install? Files are moved aside, not deleted — reactivate any time.',
      )
    )
      return
    setBusyKey(inst.id)
    setNote('')
    try {
      const res = await api.installToggle(
        inst.host,
        inst.path,
        inst.state === 'active' ? 'deactivate' : 'activate',
      )
      if (!res.ok) {
        const failed = Array.isArray(res.failed) ? res.failed.join(', ') : ''
        setNote(res.error || (failed && `unrestored: ${failed}`) || 'action failed')
        return
      }
      // Full reload: toggling an install also changes the MCP card and the
      // Installation snapshot, which live in sibling components with their own state.
      window.location.reload()
    } catch (e) {
      setNote(e.message)
    } finally {
      setBusyKey('')
    }
  }

  return (
    <>
      {note ? <p className="badge bad">{note}</p> : null}
      {data.installs.map((inst) => {
        const isDisabled = busyKey === inst.id
        const on = inst.state === 'active'
        const badge =
          inst.state === 'active'
            ? 'active'
            : inst.state === 'disabled'
              ? 'disabled'
              : 'not installed'
        return (
          <div className="mcp-row" key={inst.id}>
            <div className="mcp-info">
              <div className="mi-top">
                <strong>
                  {inst.host} · {inst.scope}
                </strong>
                <span className={`badge ${on ? 'ok' : ''}`}>{badge}</span>
              </div>
              <p>
                <code>{inst.path}</code>
              </p>
            </div>
            {inst.state !== 'absent' ? (
              <div
                className={`sw-toggle${on ? ' on' : ''}`}
                role="switch"
                aria-checked={on}
                aria-disabled={isDisabled || undefined}
                tabIndex={isDisabled ? -1 : 0}
                onClick={isDisabled ? undefined : () => toggle(inst)}
                onKeyDown={
                  isDisabled
                    ? undefined
                    : (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          if (e.key === ' ') e.preventDefault()
                          toggle(inst)
                        }
                      }
                }
              />
            ) : onAction ? (
              <button className="btn ghost" onClick={() => install(inst)}>
                Install
              </button>
            ) : null}
          </div>
        )
      })}
    </>
  )
}
