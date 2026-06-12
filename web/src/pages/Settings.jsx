import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Icon } from '../components/Icon.jsx'

function McpServers() {
  const [data, setData] = useState(null) // { targets, default }
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [busyKey, setBusyKey] = useState('')

  const load = () => api.mcp().then(setData).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])

  if (err) return <p className="badge bad">{err}</p>
  if (!data) return <p className="loading">Loading…</p>

  const toggle = async (target, s) => {
    const key = target.path + s.name
    setBusyKey(key)
    setNote('')
    try {
      await api.mcpToggle(target.path, s.name, s.state !== 'enabled')
      await load()
    } catch (e) { setNote(e.message) } finally { setBusyKey('') }
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
                    <span className={`badge ${s.state === 'enabled' ? 'ok' : ''}`}>
                      {s.state}
                    </span>
                  </div>
                  <p>{s.desc}</p>
                </div>
                {s.state !== 'absent' ? (
                  <div
                    className={`sw-toggle${s.state === 'enabled' ? ' on' : ''}`}
                    role="switch"
                    aria-checked={s.state === 'enabled'}
                    aria-disabled={isDisabled || undefined}
                    onClick={isDisabled ? undefined : () => toggle(t, s)}
                  />
                ) : (s.preset ? (
                  <button
                    className="btn ghost sm"
                    disabled={isDisabled}
                    onClick={() => toggle(t, s)}
                  >
                    Add
                  </button>
                ) : null)}
              </div>
            )
          })}
        </div>
      ))}
    </>
  )
}

export default function Settings({ onAction }) {
  const [setup, setSetup] = useState(null)
  const [err, setErr] = useState('')
  const [choices, setChoices] = useState(null) // { themes, emits, current }
  const [theme, setTheme] = useState('')
  const [emit, setEmit] = useState('')

  useEffect(() => {
    api.setup().then(setSetup).catch((e) => setErr(e.message))
    api.themes().then((t) => {
      setChoices(t)
      setTheme(t.current.theme)
      setEmit(t.current.emit)
    }).catch(() => {})
  }, [])

  if (err) return <div className="container"><p className="badge bad">{err}</p></div>
  if (!setup) return <div className="container">Loading…</div>

  const upToDate = (setup.version_verdict || '').includes('up to date')

  return (
    <div style={{ maxWidth: 860 }}>
      <div className="head-row" style={{ marginBottom: 18 }}>
        <div>
          <span className="eyebrow">configure</span>
          <h1 className="h">Settings</h1>
          <p className="sub">
            The deployed install at a glance, plus the same actions as the TUI — build,
            update, MCP wiring, and an offline package.
          </p>
        </div>
      </div>

      {/* Installation card */}
      <div className="card pad-lg" style={{ marginBottom: 16 }}>
        <div className="card-head"><h3>Installation</h3></div>
        {[
          ['Deployed', (
            <span className={`badge ${setup.deployed ? 'ok' : 'warn'}`}>
              {setup.deployed ? 'yes' : 'no'}
            </span>
          )],
          ['Target', <code>{setup.target}</code>],
          ['Install mode', setup.emit],
          ['Theme', <span style={{ textTransform: 'capitalize' }}>{setup.theme}</span>],
          ['Version', (
            <span className={`badge ${upToDate ? 'ok' : 'warn'}`}>
              {setup.version_verdict}
            </span>
          )],
          ['Installed build', <span className="mono">{setup.installed_fp || '(none)'}</span>],
          ['Source build', <span className="mono">{setup.source_fp}</span>],
          ['Source root', setup.root],
          ['Memory store', (
            <span>
              {setup.memory_dir || '(not found)'} · {setup.facts} fact{setup.facts === 1 ? '' : 's'}
            </span>
          )],
          ['Python', setup.python],
        ].map(([k, v]) => (
          <div className="kv" key={k}>
            <span className="k">{k}</span>
            <span className="v">{v}</span>
          </div>
        ))}
      </div>

      {/* Build & update card */}
      <div className="card pad-lg" style={{ marginBottom: 16 }}>
        <div className="card-head"><h3>Build &amp; update</h3></div>
        <p className="sub" style={{ marginBottom: 16 }}>
          Rebuild the deployed harness in a chosen voice and mode, or pull the latest
          Geneseed and re-render. Either runs live in the terminal.
        </p>
        {choices && (
          <div className="row wrap" style={{ gap: 16, alignItems: 'flex-end' }}>
            <label className="stack" style={{ gap: 6 }}>
              <span className="tick">Voice</span>
              <select
                className="sel"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
              >
                {choices.themes.map((t) => (
                  <option key={t.name} value={t.name}>{t.name}</option>
                ))}
              </select>
            </label>
            <label className="stack" style={{ gap: 6 }}>
              <span className="tick">Mode</span>
              <select
                className="sel"
                value={emit}
                onChange={(e) => setEmit(e.target.value)}
              >
                {choices.emits.map((em) => (
                  <option key={em.name} value={em.name}>{em.name}</option>
                ))}
              </select>
            </label>
            <button
              className="btn ghost"
              onClick={() => onAction('build', { theme, emit })}
            >
              <Icon name="build" />Build
            </button>
            <button className="btn" onClick={() => onAction('update')}>
              <Icon name="refresh" />Update
            </button>
          </div>
        )}
      </div>

      {/* MCP servers card */}
      <div className="card pad-lg" style={{ marginBottom: 16 }}>
        <div className="card-head"><h3>MCP servers</h3></div>
        <p className="sub" style={{ marginBottom: 16 }}>
          Wire MCP servers into OpenCode — per project or globally. Toggles rewrite
          only the <code>mcp</code> block.
        </p>
        <McpServers />
      </div>

      {/* Offline package card */}
      <div className="card pad-lg">
        <div className="card-head"><h3>Offline package</h3></div>
        <p className="sub" style={{ marginBottom: 16 }}>
          For air-gapped machines: download a zip of this source tree, carry it over,
          then <code>geneseed upgrade --zip &lt;file&gt;</code> — same validation, no network.
        </p>
        <a className="btn ghost" href="/api/offline-zip" download>
          <Icon name="download" />Download offline package
        </a>
      </div>
    </div>
  )
}
