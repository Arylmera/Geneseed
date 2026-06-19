import React, { useState } from 'react'
import { api } from '../../api/index.js'
import { useAsync } from '../../hooks/useAsync.js'
import Loading from '../../components/Loading.jsx'
import ErrorState from '../../components/ErrorState.jsx'

// The harness-install panel: one row per detected install (host × scope). An active
// or disabled install shows a switch that deactivates the whole install — files moved
// aside, not deleted — and reactivates it (the on-disk stash dir is the truth). A
// not-installed location shows a voice picker + an Install button to deploy it there.
export default function Installs({ onAction, themes = [], currentTheme }) {
  const { data, error } = useAsync(() => api.installs(), []) // { installs }
  const [note, setNote] = useState('')
  const [busyKey, setBusyKey] = useState('')
  const [voice, setVoice] = useState({}) // chosen install voice, keyed by row id

  if (error) return <ErrorState error={error} />
  if (!data) return <Loading />

  // The voice a fresh install gets — the per-row pick, defaulting to the current deployed
  // voice so a new Claude install matches your OpenCode one unless you change it.
  const voiceFor = (inst) => voice[inst.id] || currentTheme || 'neutral'

  // Install Geneseed into a detected-but-absent location with the chosen voice. Runs as a
  // background job streamed to the console; on finish the page reloads and the row flips to
  // active. Non-destructive — deactivate/uninstall undo it.
  const install = (inst) => {
    const theme = voiceFor(inst)
    if (
      window.confirm(
        `Install Geneseed into ${inst.path} with the “${theme}” voice? Files are added ` +
          `non-destructively (your own config is left untouched); you can deactivate or ` +
          `uninstall it later.`,
      )
    )
      onAction?.('install', { host: inst.host, scope: inst.scope, path: inst.path, theme })
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
              <div className="row gap-8">
                {themes.length ? (
                  <select
                    className="sel"
                    aria-label="voice for the new install"
                    value={voiceFor(inst)}
                    onChange={(e) => setVoice((v) => ({ ...v, [inst.id]: e.target.value }))}
                  >
                    {themes.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                ) : null}
                <button className="btn ghost" onClick={() => install(inst)}>
                  Install
                </button>
              </div>
            ) : null}
          </div>
        )
      })}
    </>
  )
}
