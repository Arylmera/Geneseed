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
    </div>
  )
}
