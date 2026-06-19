import React, { useState } from 'react'
import { api } from '../../api/index.js'
import { useAsync } from '../../hooks/useAsync.js'
import Loading from '../../components/Loading.jsx'
import ErrorState from '../../components/ErrorState.jsx'

// A voice <select> in the app's `.sel` style. Renders nothing until the theme list loads.
function VoiceSelect({ label, value, themes, onChange }) {
  if (!themes.length) return null
  return (
    <select
      className="sel"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {themes.map((t) => (
        <option key={t.name} value={t.name}>
          {t.name}
        </option>
      ))}
    </select>
  )
}

// An on/off switch — deactivates a whole install (files moved aside, not deleted) or
// reactivates it. The on-disk stash dir is the source of truth.
function Switch({ on, disabled, onToggle }) {
  const keyToggle = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      if (e.key === ' ') e.preventDefault()
      onToggle()
    }
  }
  return (
    <div
      className={`sw-toggle${on ? ' on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={disabled ? undefined : onToggle}
      onKeyDown={disabled ? undefined : keyToggle}
    />
  )
}

// The harness-install panel: one row per detected install (host × scope).
//   not installed → a voice picker + Install button to deploy it there
//   active        → a voice picker + Re-theme button (rebuild in place) + a switch
//   disabled      → a switch to reactivate
// Mutations refetch via dataRev / onMutated — no full page reload, so nothing flashes.
export default function Installs({ onAction, themes = [], currentTheme, dataRev, onMutated }) {
  const { data, error } = useAsync(() => api.installs(), [dataRev]) // { installs }
  const [note, setNote] = useState('')
  const [busyKey, setBusyKey] = useState('')
  const [pick, setPick] = useState({}) // chosen voice, keyed by row id

  if (error) return <ErrorState error={error} />
  if (!data) return <Loading />

  // The voice a row acts on: the explicit pick, else the install's own theme (active
  // rows), else the current deployed voice — so a new install matches your existing one.
  const voiceFor = (inst) => pick[inst.id] || inst.theme || currentTheme || 'neutral'
  const setVoice = (inst, v) => setPick((p) => ({ ...p, [inst.id]: v }))

  // Install a not-installed location, or re-theme an active one — both rebuild via the
  // 'install' action (a non-destructive in-place re-emit), streamed to the console.
  const applyVoice = (inst) => {
    const theme = voiceFor(inst)
    const msg =
      inst.state === 'absent'
        ? `Install Geneseed into ${inst.path} with the “${theme}” voice? Files are added ` +
          `non-destructively (your own config is left untouched); deactivate or uninstall later.`
        : `Re-theme this install to the “${theme}” voice? It rebuilds in place — non-destructive.`
    if (window.confirm(msg))
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
      // Refetch installs + MCP (the active set drives MCP targets) — no full reload.
      onMutated?.()
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
        const on = inst.state === 'active'
        const label = `voice for ${inst.host} · ${inst.scope}`
        const badge = on ? 'active' : inst.state === 'disabled' ? 'disabled' : 'not installed'
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
            <div className="row gap-8">
              {inst.state === 'absent' && onAction ? (
                <>
                  <VoiceSelect
                    label={label}
                    value={voiceFor(inst)}
                    themes={themes}
                    onChange={(v) => setVoice(inst, v)}
                  />
                  <button className="btn ghost" onClick={() => applyVoice(inst)}>
                    Install
                  </button>
                </>
              ) : null}
              {on && onAction ? (
                <>
                  <VoiceSelect
                    label={label}
                    value={voiceFor(inst)}
                    themes={themes}
                    onChange={(v) => setVoice(inst, v)}
                  />
                  <button
                    className="btn ghost"
                    disabled={voiceFor(inst) === inst.theme}
                    onClick={() => applyVoice(inst)}
                  >
                    Re-theme
                  </button>
                </>
              ) : null}
              {inst.state !== 'absent' ? (
                <Switch on={on} disabled={busyKey === inst.id} onToggle={() => toggle(inst)} />
              ) : null}
            </div>
          </div>
        )
      })}
    </>
  )
}
