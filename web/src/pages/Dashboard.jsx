import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { go } from '../router.js'

const SECTIONS = [
  ['agents', 'Agents'], ['skills', 'Skills'], ['laws', 'Laws'],
  ['memory', 'Memory'], ['notebook', 'Notebook'], ['config', 'Config'],
]

export default function Dashboard({ overview, onAction }) {
  const [choices, setChoices] = useState(null) // { themes:[{name,blurb}], emits:[{name,desc}], current }
  const [theme, setTheme] = useState('')
  const [emit, setEmit] = useState('')

  useEffect(() => {
    api.themes().then((t) => {
      setChoices(t)
      setTheme(t.current.theme)
      setEmit(t.current.emit)
    }).catch(() => {})
  }, [])

  if (!overview) return <div className="container">Loading…</div>
  const d = overview.diff
  const pending = d ? d.edited + d.added + d.missing : 0
  const stop = (e) => e.stopPropagation()

  return (
    <div className="container">
      <div className="cards" style={{ marginBottom: 16 }}>
        <div className="card" onClick={() => onAction('doctor')}>
          <h3>🩺 Doctor</h3>
          <span className={`badge ${overview.doctor.ok ? 'ok' : 'warn'}`}>
            {overview.doctor.ok ? 'healthy' : `${overview.doctor.problems.length} issues`}
          </span>
          <p className="muted">Click to re-run</p>
        </div>
        <div className="card" onClick={() => go('#/diff')}>
          <h3>📝 Local edits</h3>
          <div className="big">{overview.deployed ? pending : '—'}</div>
          <p className="muted">Review &amp; export improvements</p>
        </div>
        <div className="card no-hover">
          <h3>🔄 Update / Build</h3>
          <p className="muted">Last build: {overview.build_time || 'unknown'}</p>
          {choices && (
            <div className="picker" onClick={stop}>
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
          <div className="row-actions" onClick={stop}>
            <button className="btn ghost" onClick={() => onAction('build', { theme, emit })}>
              Build
            </button>
            <button className="btn" onClick={() => onAction('update')}>Update</button>
          </div>
        </div>
      </div>
      <div className="cards">
        {SECTIONS.map(([key, label]) => (
          <div className="card" key={key} onClick={() => go(`#/section/${key}`)}>
            <h3>{label}</h3>
            <div className="big">{overview.counts[key] ?? '—'}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
