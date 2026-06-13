import React from 'react'
import { go } from '../lib/router.js'
import { Icon, Sprout } from './Icon.jsx'

// Left navigation rail, grouped like the design. `match` decides which item
// lights up for the current route; `tag` surfaces a live count from the overview
// (e.g. pending edits, doctor problems).
const NAV = [
  { group: 'Harness' },
  { hash: '#/', id: 'dashboard', label: 'Dashboard', icon: 'dashboard',
    match: (r) => r.view === 'dashboard' },
  { hash: '#/section/agents', id: 'library', label: 'Library', icon: 'library',
    match: (r) => r.view === 'section' || r.view === 'item' },
  { hash: '#/graph', id: 'graph', label: 'Graph', icon: 'graph', match: (r) => r.view === 'graph' },
  { group: 'Maintain' },
  { hash: '#/diff', id: 'changes', label: 'Changes', icon: 'changes', match: (r) => r.view === 'diff',
    tag: (o) => (o?.diff ? o.diff.edited + o.diff.added : null) || null },
  { hash: '#/doctor', id: 'doctor', label: 'Doctor', icon: 'doctor', match: (r) => r.view === 'doctor',
    tag: (o) => (o?.doctor && !o.doctor.ok ? o.doctor.problems.length : null), warn: true },
  { group: 'Configure' },
  { hash: '#/themes', id: 'themes', label: 'Themes', icon: 'themes', match: (r) => r.view === 'themes' },
  { hash: '#/settings', id: 'settings', label: 'Settings', icon: 'settings',
    match: (r) => r.view === 'settings' },
]

export default function Rail({ route, overview, onOpenVoice }) {
  return (
    <aside className="rail">
      <div className="rail-brand" onClick={() => go('#/')} title="Dashboard">
        <Sprout />
        <div className="brand-text">
          <span className="brand-name">Gene<b>seed</b></span>
          <span className="brand-sub">harness console</span>
        </div>
      </div>
      {NAV.map((n, i) => {
        if (n.group) return <div className="rail-group" key={'g' + i}>{n.group}</div>
        const tag = n.tag ? n.tag(overview) : null
        return (
          <div className="rail-nav" key={n.id}>
            <a className={`rail-item ${n.match(route) ? 'active' : ''}`} href={n.hash}
              aria-current={n.match(route) ? 'page' : undefined}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {tag ? <span className="tag" style={n.warn ? { color: 'var(--warn)' } : null}>{tag}</span> : null}
            </a>
          </div>
        )
      })}
      <div className="rail-spacer" />
      <div className="rail-foot">
        <div className="voice" onClick={onOpenVoice} title="Switch deployed voice">
          <span className="voice-orb" />
          <div className="voice-meta">
            <div className="vk">deployed voice</div>
            <div className="vv">{overview?.theme || '—'}</div>
          </div>
          <Icon name="chevron" className="chev glyph" />
        </div>
      </div>
    </aside>
  )
}
