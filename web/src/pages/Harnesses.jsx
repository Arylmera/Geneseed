import React, { useMemo, useState } from 'react'
import { Icon } from '../components/Icon.jsx'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'

// The harness orchestration page as one table: every detected install (host × scope) is
// a row — OpenCode and Claude, global and per-repo — independently activated, re-themed,
// or deactivated. The MCP servers wired into an install live INSIDE its row: an active
// install with MCP wiring expands to a detail panel listing its servers (OpenCode under
// opencode.json's `mcp`, Claude under .mcp.json / ~/.claude.json's `mcpServers`).
// "Rebuild all" re-emits every active install in its own voice + mode as one background
// job. Mutations refetch via dataRev / onMutated — no full reload, nothing flashes.

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
// reactivates it; also drives individual MCP servers. The on-disk stash is the truth.
function Switch({ on, disabled, label, onToggle }) {
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
      aria-label={label}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={disabled ? undefined : onToggle}
      onKeyDown={disabled ? undefined : keyToggle}
    />
  )
}

// Join key for the MCP-target → install pairing: an install owns the targets the API
// tags with its (host, root). Keying on the install identity (not the config's dirname)
// is what lets a Claude global target — whose ~/.claude.json sits OUTSIDE its ~/.claude
// root — still attach to the right row.
const installKey = (host, root) => `${host} ${root}`

export default function Harnesses({ onAction, themes = [], currentTheme, dataRev, onMutated }) {
  const { data: instData, error: instErr } = useAsync(() => api.installs(), [dataRev]) // { installs }
  const { data: mcpData, error: mcpErr } = useAsync(() => api.mcp(), [dataRev]) // { targets }
  const [note, setNote] = useState('')
  const [busyKey, setBusyKey] = useState('') // install toggle in flight
  const [mcpBusy, setMcpBusy] = useState('') // mcp server toggle in flight
  const [pick, setPick] = useState({}) // chosen voice, keyed by row id
  const [collapsed, setCollapsed] = useState({}) // explicit collapses; MCP rows open by default

  // Group MCP targets by their owning install (host, root). api_mcp only returns targets
  // for active installs, so every group has a matching harness row to nest beneath.
  const mcpByInstall = useMemo(() => {
    const m = {}
    for (const t of mcpData?.targets || []) {
      const k = installKey(t.host || 'opencode', t.root)
      ;(m[k] || (m[k] = [])).push(t)
    }
    return m
  }, [mcpData])

  if (instErr || mcpErr) return <ErrorState error={instErr || mcpErr} />
  if (!instData || !mcpData) return <Loading />

  const installs = instData.installs
  const activeCount = installs.filter((i) => i.state === 'active').length

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

  const toggleInstall = async (inst) => {
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
      onMutated?.() // refetch installs + MCP (the active set drives MCP targets) — no full reload
    } catch (e) {
      setNote(e.message)
    } finally {
      setBusyKey('')
    }
  }

  const toggleMcp = async (target, s) => {
    const key = target.path + s.name
    setMcpBusy(key)
    setNote('')
    try {
      await api.mcpToggle(target.path, s.name, s.state !== 'enabled')
      onMutated?.()
    } catch (e) {
      setNote(e.message)
    } finally {
      setMcpBusy('')
    }
  }

  const toggleOpen = (id) => setCollapsed((c) => ({ ...c, [id]: !c[id] }))

  return (
    <div className="card pad-lg mb-16">
      <div className="card-head">
        <h3>Harnesses</h3>
        <div className="right">
          <span className="tick">
            {activeCount} active · {installs.length} total
          </span>
          <button className="btn" onClick={() => onAction('build-all')}>
            <Icon name="refresh" /> Rebuild all
          </button>
        </div>
      </div>
      <p className="sub mb-16">
        Every Geneseed install on this machine — OpenCode and Claude Code, global and per-repo.
        Toggle one off without deleting it (files move aside, reactivate any time). Active rows
        expand to wire their MCP servers. <strong>Rebuild all</strong> re-emits every active install
        in its own voice and mode, as one background job.
      </p>

      {note ? <p className="badge bad mb-16">{note}</p> : null}

      <div className="tbl-scroll">
        <table className="tbl harness-tbl">
          <thead>
            <tr>
              <th aria-label="expand" />
              <th>Harness</th>
              <th>Voice</th>
              <th>MCP</th>
              <th>Status</th>
              <th className="th-acts" />
            </tr>
          </thead>
          <tbody>
            {installs.map((inst) => {
              const on = inst.state === 'active'
              const targets = mcpByInstall[installKey(inst.host, inst.path)] || []
              const hasMcp = targets.length > 0
              const open = hasMcp && !collapsed[inst.id]
              const enabled = targets.reduce(
                (n, t) => n + t.servers.filter((s) => s.state === 'enabled').length,
                0,
              )
              const label = `voice for ${inst.host} · ${inst.scope}`
              const badge = on ? 'active' : inst.state === 'disabled' ? 'disabled' : 'not installed'
              return (
                <React.Fragment key={inst.id}>
                  <tr>
                    <td className="h-exp-cell">
                      {hasMcp ? (
                        <button
                          className="h-exp"
                          aria-expanded={open}
                          aria-label={`${open ? 'collapse' : 'expand'} MCP for ${inst.host} · ${inst.scope}`}
                          onClick={() => toggleOpen(inst.id)}
                        >
                          <Icon name="chevron" className={`glyph${open ? ' open' : ''}`} />
                        </button>
                      ) : null}
                    </td>
                    <td>
                      <span className="name">
                        {inst.host} · {inst.scope}
                      </span>
                      <code className="h-path" title={inst.path}>
                        {inst.path}
                      </code>
                    </td>
                    <td className="mono">{inst.theme || '—'}</td>
                    <td>
                      {hasMcp ? (
                        <span className={enabled ? 'mono' : 'mono muted'}>{enabled} on</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${on ? 'ok' : ''}`}>{badge}</span>
                    </td>
                    <td>
                      <div className="h-acts">
                        {inst.state === 'absent' && onAction ? (
                          <>
                            <VoiceSelect
                              label={label}
                              value={voiceFor(inst)}
                              themes={themes}
                              onChange={(v) => setVoice(inst, v)}
                            />
                            <button className="btn ghost sm" onClick={() => applyVoice(inst)}>
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
                              className="btn ghost sm"
                              disabled={voiceFor(inst) === inst.theme}
                              onClick={() => applyVoice(inst)}
                            >
                              Re-theme
                            </button>
                          </>
                        ) : null}
                        {inst.state !== 'absent' ? (
                          <Switch
                            on={on}
                            disabled={busyKey === inst.id}
                            label={`activate ${inst.host} · ${inst.scope}`}
                            onToggle={() => toggleInstall(inst)}
                          />
                        ) : (
                          // No switch when nothing's installed — but hold its place so the
                          // dropdown + Install button stay aligned with the active rows.
                          <span className="h-sw-spacer" aria-hidden="true" />
                        )}
                      </div>
                    </td>
                  </tr>
                  {open ? (
                    <tr className="h-detail-row">
                      <td />
                      <td colSpan={5} className="h-detail">
                        {targets.map((t) => (
                          <div className="mcp-target" key={t.path}>
                            <div className="mt-head">
                              {t.label} · <code>{t.path}</code>
                              {t.commented && ' (has comments; edit by hand)'}
                            </div>
                            {t.servers.map((s) => {
                              const key = t.path + s.name
                              const isDisabled = !!(t.commented || mcpBusy === key)
                              return (
                                <div className="mcp-row" key={s.name}>
                                  <div className="mcp-info">
                                    <div className="mi-top">
                                      <strong>{s.label}</strong>
                                      <span
                                        className={`badge ${s.state === 'enabled' ? 'ok' : ''}`}
                                      >
                                        {s.state}
                                      </span>
                                    </div>
                                    <p>{s.desc}</p>
                                  </div>
                                  {s.state !== 'absent' ? (
                                    <Switch
                                      on={s.state === 'enabled'}
                                      disabled={isDisabled}
                                      label={`${s.label} server`}
                                      onToggle={() => toggleMcp(t, s)}
                                    />
                                  ) : s.preset ? (
                                    <button
                                      className="btn ghost sm"
                                      disabled={isDisabled}
                                      onClick={() => toggleMcp(t, s)}
                                    >
                                      Add
                                    </button>
                                  ) : null}
                                </div>
                              )
                            })}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
