import React from 'react'
import { go } from '../router.js'

const SECTIONS = [
  ['agents', 'Agents', '🤖'], ['skills', 'Skills', '🧰'], ['laws', 'Laws', '⚖️'],
  ['memory', 'Memory', '🧠'], ['notebook', 'Notebook', '📓'], ['wiki', 'Wiki', '📚'],
  ['config', 'Config', '🛠️'],
]

export default function Dashboard({ overview, onAction }) {
  if (!overview) return <div className="container">Loading…</div>
  const d = overview.diff
  const pending = d ? d.edited + d.added + d.missing : 0
  return (
    <div className="container">
      <div className="hero">
        <div>
          <h2 className="hero-title">
            {overview.deployed ? 'Harness deployed' : 'No deployed harness'}
          </h2>
          <p className="muted hero-sub">
            {overview.theme} voice · {overview.emit} · {overview.target}
          </p>
        </div>
        <div className="hero-meta">
          <span className={`badge ${overview.deployed ? 'ok' : 'warn'}`}>
            {overview.deployed ? 'deployed' : 'not deployed'}
          </span>
          <span className="muted">Last build: {overview.build_time || 'unknown'}</span>
          <a href="#/settings">Setup details →</a>
        </div>
      </div>

      <div className="cards" style={{ marginBottom: 16 }}>
        <div className="card" onClick={() => go('#/doctor')}>
          <h3>🩺 Doctor</h3>
          <span className={`badge ${overview.doctor.ok ? 'ok' : 'warn'}`}>
            {overview.doctor.ok ? 'healthy' : `${overview.doctor.problems.length} issues`}
          </span>
          <p className="muted">
            {overview.doctor.checked_at
              ? `Checked ${overview.doctor.checked_at}` : 'Per-check report'}
          </p>
        </div>
        <div className="card" onClick={() => go('#/diff')}>
          <h3>📝 Local edits</h3>
          <div className="big">{overview.deployed ? pending : '—'}</div>
          <p className="muted">Review &amp; export improvements</p>
        </div>
        <div className="card" onClick={() => go('#/settings')}>
          <h3>⚙️ Setup</h3>
          <p className="muted">Install details, build &amp; update</p>
        </div>
      </div>

      <div className="cards">
        {SECTIONS.map(([key, label, icon]) => (
          <div className="card" key={key} onClick={() => go(`#/section/${key}`)}>
            <h3>{icon} {label}</h3>
            <div className="big">{overview.counts[key] ?? '—'}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
