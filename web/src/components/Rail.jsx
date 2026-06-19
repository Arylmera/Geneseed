import React from 'react'
import { go } from '../lib/router.js'
import { Icon, Sprout } from './Icon.jsx'

// Left navigation rail, grouped like the design. `match` decides which item
// lights up for the current route; `tag` surfaces a live count from the overview
// (e.g. pending edits, doctor problems). Library and Docs no longer expand
// into nested sub-menus here — both pages own their own horizontal chip-bar
// for in-page sub-navigation now.
const NAV = [
  { group: 'Harness' },
  {
    hash: '#/',
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'dashboard',
    match: (r) => r.view === 'dashboard',
  },
  {
    hash: '#/laws',
    id: 'laws',
    label: 'Laws',
    icon: 'law',
    match: (r) =>
      r.view === 'laws' ||
      (r.view === 'section' && r.section === 'laws') ||
      (r.view === 'item' && r.type === 'law'),
    tag: (o) => o?.counts?.laws ?? null,
  },
  {
    hash: '#/skills',
    id: 'skills',
    label: 'Skills',
    icon: 'skill',
    match: (r) =>
      r.view === 'skills' ||
      (r.view === 'section' && r.section === 'skills') ||
      (r.view === 'item' && r.type === 'skill'),
    tag: (o) => o?.counts?.skills ?? null,
  },
  {
    hash: '#/library',
    id: 'library',
    label: 'Library',
    icon: 'library',
    // Laws and Skills own their item/section routes (matched above); the Library
    // tab claims every other section/item so its highlight doesn't steal theirs.
    match: (r) =>
      r.view === 'library' ||
      (r.view === 'section' && r.section !== 'laws' && r.section !== 'skills') ||
      (r.view === 'item' && r.type !== 'law' && r.type !== 'skill'),
  },
  {
    hash: '#/docs',
    id: 'docs',
    label: 'Docs',
    icon: 'docs',
    match: (r) => r.view === 'docs',
  },
  { hash: '#/graph', id: 'graph', label: 'Graph', icon: 'graph', match: (r) => r.view === 'graph' },
  { group: 'Maintain' },
  {
    hash: '#/diff',
    id: 'changes',
    label: 'Changes',
    icon: 'changes',
    match: (r) => r.view === 'diff',
    tag: (o) => (o?.diff ? o.diff.edited + o.diff.added : null) || null,
  },
  {
    hash: '#/doctor',
    id: 'doctor',
    label: 'Doctor',
    icon: 'doctor',
    match: (r) => r.view === 'doctor',
    tag: (o) => (o?.doctor && !o.doctor.ok ? o.doctor.problems.length : null),
    warn: true,
  },
  { group: 'Configure' },
  {
    hash: '#/harnesses',
    id: 'harnesses',
    label: 'Harnesses',
    icon: 'layers',
    match: (r) => r.view === 'harnesses',
  },
  {
    hash: '#/themes',
    id: 'themes',
    label: 'Themes',
    icon: 'themes',
    match: (r) => r.view === 'themes',
  },
  {
    hash: '#/settings',
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    match: (r) => r.view === 'settings',
  },
  { group: 'About' },
  {
    hash: '#/about',
    id: 'about',
    label: 'About',
    icon: 'about',
    match: (r) => r.view === 'about',
  },
]

export default function Rail({ route, overview, onOpenVoice }) {
  return (
    <aside className="rail">
      <div className="rail-brand" onClick={() => go('#/')} title="Dashboard">
        <Sprout />
        <div className="brand-text">
          <span className="brand-name">
            Gene<b>seed</b>
          </span>
          <span className="brand-sub">harness console</span>
        </div>
      </div>
      {NAV.map((n, i) => {
        if (n.group)
          return (
            <div className="rail-group" key={'g' + i}>
              {n.group}
            </div>
          )
        const tag = n.tag ? n.tag(overview) : null
        const lit = n.match(route)
        return (
          <div className="rail-nav" key={n.id}>
            <a
              className={`rail-item ${lit ? 'active' : ''}`}
              href={n.hash}
              aria-current={lit ? 'page' : undefined}
            >
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {tag ? (
                <span className="tag" style={n.warn ? { color: 'var(--warn)' } : null}>
                  {tag}
                </span>
              ) : null}
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
