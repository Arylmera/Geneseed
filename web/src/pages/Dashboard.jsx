import React from 'react'
import { go } from '../router.js'

const SECTIONS = [
  ['agents', 'Agents'], ['skills', 'Skills'], ['laws', 'Laws'],
  ['memory', 'Memory'], ['notebook', 'Notebook'], ['config', 'Config'],
]

export default function Dashboard({ overview, onAction }) {
  if (!overview) return <div className="container">Loading…</div>
  const d = overview.diff
  const pending = d ? d.edited + d.added + d.missing : 0
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
        <div className="card" onClick={() => onAction('update')}>
          <h3>🔄 Update</h3>
          <p className="muted">Last build: {overview.build_time || 'unknown'}</p>
          <button className="btn ghost" onClick={(e) => { e.stopPropagation(); onAction('build') }}>
            Build
          </button>
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
