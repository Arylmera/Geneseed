import React, { useEffect, useState } from 'react'
import { api } from '../api.js'

function Row({ k, children }) {
  return (
    <div className="kv">
      <span className="kv-key">{k}</span>
      <span className="kv-val">{children}</span>
    </div>
  )
}

function McpServers() {
  const [data, setData] = useState(null) // { targets, default }
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [busyKey, setBusyKey] = useState('')

  const load = () => api.mcp().then(setData).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])

  if (err) return <p className="badge warn">{err}</p>
  if (!data) return <p className="muted">Loading…</p>

  const toggle = async (target, s) => {
    const key = target.path + s.name
    setBusyKey(key)
    setNote('')
    try {
      await api.mcpToggle(target.path, s.name, s.state !== 'enabled')
      await load()
    } catch (e) { setNote(e.message) } finally { setBusyKey('') }
  }

  const verb = (s) =>
    s.state === 'enabled' ? 'Disable' : s.state === 'disabled' ? 'Enable' : 'Add'

  return (
    <>
      {note ? <p className="badge warn">{note}</p> : null}
      {data.targets.map((t) => (
        <div className="mcp-target" key={t.path}>
          <p className="muted mcp-path">
            {t.label} — <code>{t.path}</code>
            {t.commented && ' (has comments — edit by hand)'}
          </p>
          {t.servers.map((s) => (
            <div className="mcp-row" key={s.name}>
              <div className="mcp-info">
                <strong>{s.label}</strong>
                <span className={`badge ${s.state === 'enabled' ? 'ok' : ''}`}>
                  {s.state}
                </span>
                <p className="muted">{s.desc}</p>
              </div>
              {(s.state !== 'absent' || s.preset) && (
                <button
                  className="btn ghost sm"
                  disabled={t.commented || busyKey === t.path + s.name}
                  onClick={() => toggle(t, s)}
                >
                  {verb(s)}
                </button>
              )}
            </div>
          ))}
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

  if (err) return <div className="container"><p className="badge warn">{err}</p></div>
  if (!setup) return <div className="container">Loading…</div>

  const upToDate = (setup.version_verdict || '').includes('up to date')
  return (
    <div className="container narrow">
      <h2>Settings</h2>

      <section className="panel">
        <h3>Installation</h3>
        <Row k="Deployed">
          <span className={`badge ${setup.deployed ? 'ok' : 'warn'}`}>
            {setup.deployed ? 'yes' : 'no'}
          </span>
        </Row>
        <Row k="Target">{setup.target}</Row>
        <Row k="Install mode">{setup.emit}</Row>
        <Row k="Theme">
          <span className="swatch" data-accent={setup.accent} /> {setup.theme}
        </Row>
        <Row k="Version">
          <span className={`badge ${upToDate ? 'ok' : 'warn'}`}>{setup.version_verdict}</span>
        </Row>
        <Row k="Installed build">{setup.installed_fp || '(none)'}</Row>
        <Row k="Source build">{setup.source_fp}</Row>
        <Row k="Source root">{setup.root}</Row>
        <Row k="Memory store">
          {setup.memory_dir || '(not found)'} · {setup.facts} fact{setup.facts === 1 ? '' : 's'}
        </Row>
        <Row k="Python">{setup.python}</Row>
      </section>

      <section className="panel">
        <h3>Build &amp; update</h3>
        <p className="muted">
          Rebuild the deployed harness in a chosen voice and install mode, or pull
          the latest Geneseed and re-render. Either runs live in the console.
        </p>
        {choices && (
          <div className="picker">
            <label>
              <span className="label">Theme</span>
              <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                {choices.themes.map((t) => (
                  <option key={t.name} value={t.name}>{t.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">Mode</span>
              <select value={emit} onChange={(e) => setEmit(e.target.value)}>
                {choices.emits.map((em) => (
                  <option key={em.name} value={em.name}>{em.name}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="row-actions">
          <button className="btn ghost" onClick={() => onAction('build', { theme, emit })}>
            Build
          </button>
          <button className="btn" onClick={() => onAction('update')}>Update</button>
        </div>
      </section>

      <section className="panel">
        <h3>MCP servers</h3>
        <p className="muted">
          Wire MCP servers into OpenCode — per project or globally. Toggles rewrite
          only the <code>mcp</code> block, exactly like the TUI screen.
        </p>
        <McpServers />
      </section>

      <section className="panel">
        <h3>Offline package</h3>
        <p className="muted">
          For machines without GitHub access (corporate proxy, air-gapped): download
          a zip of this source tree, carry it over, then update there with{' '}
          <code>geneseed upgrade --zip &lt;file&gt;</code> — same validation and
          rebuild as a normal upgrade, no network needed.
        </p>
        <a className="btn ghost" href="/api/offline-zip" download>
          Download offline package
        </a>
      </section>
    </div>
  )
}
