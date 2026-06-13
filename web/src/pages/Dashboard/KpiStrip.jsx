import React from 'react'
import { go } from '../../lib/router.js'
import { editCount } from '../../lib/format.js'

// The four headline KPIs: agents, skills, laws, and local edits (which links
// through to the diff view).
export default function KpiStrip({ overview }) {
  const edits = editCount(overview.diff)
  const kpis = [
    { key: 'agents', label: 'Agents', foot: 'capability roster' },
    { key: 'skills', label: 'Skills', foot: 'repeatable rites' },
    { key: 'laws', label: 'Laws', foot: 'all enforced' },
  ]
  return (
    <div className="grid g-4 mb-16">
      {kpis.map((k, i) => (
        <div className="card kpi rise" key={k.key} style={{ animationDelay: `${i * 60}ms` }}>
          <div className="klabel">{k.label}</div>
          <div className="kval">{overview.counts?.[k.key] ?? '—'}</div>
          <div className="kfoot">
            <span>{k.foot}</span>
          </div>
        </div>
      ))}
      <div
        className="card kpi rise"
        key="edits"
        style={{ animationDelay: '180ms', cursor: 'pointer' }}
        onClick={() => go('#/diff')}
      >
        <div className="klabel">Local edits</div>
        <div className="kval">{edits}</div>
        <div className="kfoot">
          {edits > 0 && <span className="delta up">&#9650; +{edits}</span>}
          <span>awaiting export</span>
        </div>
      </div>
    </div>
  )
}
