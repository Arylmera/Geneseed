import React from 'react'
import { api } from '../api/index.js'
import { go } from '../lib/router.js'
import { useAsync } from '../hooks/useAsync.js'
import { Icon, Sprout } from './Icon.jsx'
import { SECTIONS, SECTION_ORDER, TYPE_TO_SECTION } from '../lib/sections.js'

// Which section is "open" given the route — used to light up a rail sub-item.
// Section pages carry it directly; item pages resolve it from the item's type.
function activeSection(route) {
  if (route.view === 'section') return route.section
  if (route.view === 'item') return TYPE_TO_SECTION[route.type] || route.type
  return null
}

// Which Docs group the current page lives in. Docs pages don't carry their
// group in the URL, so we resolve it from the server's grouping. Falls back
// to the first group when no page id is set (the Docs landing default).
function activeDocsGroup(route, groups) {
  if (!groups || groups.length === 0) return null
  if (!route.page) return groups[0].id
  for (const g of groups) {
    if (g.pages.some((p) => p.id === route.page)) return g.id
  }
  return null
}

// Left navigation rail, grouped like the design. `match` decides which item
// lights up for the current route; `tag` surfaces a live count from the overview
// (e.g. pending edits, doctor problems).
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
    hash: '#/library',
    id: 'library',
    label: 'Library',
    icon: 'library',
    match: (r) => r.view === 'library' || r.view === 'section' || r.view === 'item',
  },
  { hash: '#/graph', id: 'graph', label: 'Graph', icon: 'graph', match: (r) => r.view === 'graph' },
  { group: 'Learn' },
  {
    hash: '#/docs',
    id: 'docs',
    label: 'Docs',
    icon: 'docs',
    match: (r) => r.view === 'docs',
  },
  {
    hash: '#/specs',
    id: 'specs',
    label: 'Specs',
    icon: 'specs',
    match: (r) => r.view === 'specs',
  },
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
  // Fetch the Docs menu once so the rail can mirror Library's nested
  // sub-menu pattern. Cheap, cached, single-sourced from the server's
  // DOC_GROUPS so adding a group there shows up here for free.
  const { data: docsMenu } = useAsync(() => api.docs(), [])
  const docsGroups = docsMenu?.groups || []
  const activeDocs = activeDocsGroup(route, docsGroups)
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
            {/* Library expands into its sections as a nested sub-menu as soon
                as you're anywhere under it — landing, a section, or an item —
                so the sections are reachable without an extra click. */}
            {n.id === 'library' &&
              (route.view === 'library' || route.view === 'section' || route.view === 'item') && (
                <div className="rail-sub">
                  {SECTION_ORDER.map((key) => {
                    const on = activeSection(route) === key
                    const count = overview?.counts?.[key]
                    return (
                      <a
                        key={key}
                        className={`rail-subitem ${on ? 'active' : ''}`}
                        href={'#/section/' + key}
                        aria-current={on ? 'page' : undefined}
                      >
                        <span>{SECTIONS[key].label}</span>
                        {count != null ? <span className="tag">{count}</span> : null}
                      </a>
                    )
                  })}
                </div>
              )}
            {/* Docs mirrors Library's pattern: when you're under Docs the
                rail expands into the five intent groups (Get started / Core
                concepts / How-to / Reference / Deeper). Each entry lands on
                the first page of its group; the count is the page count. */}
            {n.id === 'docs' && route.view === 'docs' && docsGroups.length > 0 && (
              <div className="rail-sub">
                {docsGroups.map((g) => {
                  const on = activeDocs === g.id
                  const first = g.pages[0]?.id
                  if (!first) return null
                  return (
                    <a
                      key={g.id}
                      className={`rail-subitem ${on ? 'active' : ''}`}
                      href={'#/docs/' + encodeURIComponent(first)}
                      aria-current={on ? 'page' : undefined}
                    >
                      <span>{g.label}</span>
                      <span className="tag">{g.pages.length}</span>
                    </a>
                  )
                })}
              </div>
            )}
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
