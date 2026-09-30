import React from 'react'
import { go } from '../lib/router.js'
import { editCount, relTime } from '../lib/format.js'
import { Icon, Sprout } from './Icon.jsx'

// The five pages, in the order a visit reads them: how the harness is doing, what it
// obeys, what it knows, what is yours, and where it is installed. Each count reads data
// the shell already holds (the overview and the installs list); a page with no honest
// single number carries none rather than an invented one.
const NAV = [
  { hash: '#/', page: 'overview', label: 'Overview', icon: 'dashboard' },
  {
    hash: '#/laws',
    page: 'laws',
    label: 'Constitution',
    icon: 'law',
    // Every entry the page lists: the ethos sections, the invariants (retired ones keep
    // their number, so they are counted), and the doctrine rules.
    count: (o) =>
      o?.counts
        ? (o.counts.ontology ?? 0) + (o.counts.laws ?? 0) + (o.counts.doctrines?.rules ?? 0)
        : null,
  },
  {
    hash: '#/library',
    page: 'library',
    label: 'Library',
    icon: 'library',
    count: (o) =>
      o?.counts
        ? ['skills', 'agents', 'memory', 'notebook', 'wiki', 'config'].reduce(
            (n, k) => n + (o.counts[k] ?? 0),
            0,
          )
        : null,
  },
  { hash: '#/personal', page: 'personal', label: 'Personal', icon: 'profile' },
  {
    hash: '#/installs',
    page: 'installs',
    label: 'Installs',
    icon: 'layers',
    count: (o, installs) =>
      installs ? `${installs.filter((i) => i.state === 'active').length}/${installs.length}` : null,
  },
]

const FOOT = [
  { hash: '#/docs', page: 'docs', label: 'Docs', icon: 'docs' },
  { hash: '#/activity', page: 'activity', label: 'Activity', icon: 'activity' },
]

function NavLink({ n, lit, count, onNavigate }) {
  return (
    <a
      className={`sb-item${lit ? ' on' : ''}`}
      href={n.hash}
      aria-current={lit ? 'page' : undefined}
      onClick={() => onNavigate?.()}
    >
      <Icon name={n.icon} />
      <span className="sb-label">{n.label}</span>
      {count != null ? <span className="sb-count">{count}</span> : null}
    </a>
  )
}

// The harness's pulse, on every page: whether the doctor is happy, how far the install
// has drifted from its source, and when it was built. Three facts that decide whether
// anything else on screen can be trusted. The voice sits under them as a button, because
// switching it is the one rebuild the sidebar offers.
function Vitals({ overview, onOpenVoice }) {
  if (!overview) return null
  const d = overview.doctor
  const drift = editCount(overview.diff) + (overview.diff?.missing ?? 0)
  return (
    <div className="sb-vitals">
      <div>
        <span>doctor</span>
        <b className={!d ? '' : d.ok ? 'good' : 'bad'}>
          {!d ? 'not run' : d.ok ? 'clean' : `${d.problems.length} to fix`}
        </b>
      </div>
      <div>
        <span>drift</span>
        <b className={drift ? 'warn' : ''}>{overview.diff ? drift : 'n/a'}</b>
      </div>
      <div>
        <span>built</span>
        <b title={overview.build_time || undefined}>
          {overview.build_epoch ? `${relTime(overview.build_epoch)} ago` : 'never'}
        </b>
      </div>
      <button type="button" className="sb-voice" onClick={onOpenVoice} title="Switch voice">
        <span>voice</span>
        <b>
          {overview.theme || 'none'}
          <Icon name="chevron" />
        </b>
      </button>
    </div>
  )
}

export default function Sidebar({ route, overview, installs, onOpenVoice, onNavigate }) {
  return (
    // A <nav> landmark: this IS the app's primary navigation, and tabIndex -1 lets the
    // phone drawer's focus management in App.jsx move focus here.
    <nav className="sidebar" id="rail-nav" aria-label="Console" tabIndex={-1}>
      <button
        type="button"
        className="sb-brand"
        onClick={() => {
          go('#/')
          onNavigate?.()
        }}
        aria-label="Geneseed, go to the overview"
      >
        <span className="sb-mark">
          <Sprout />
        </span>
        <span className="sb-brand-text">
          <span className="sb-name">Geneseed</span>
          <span className="sb-ver">
            {[overview?.version && `v${overview.version}`, overview?.theme]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
      </button>
      {NAV.map((n) => (
        <NavLink
          key={n.page}
          n={n}
          lit={route.page === n.page}
          count={n.count?.(overview, installs)}
          onNavigate={onNavigate}
        />
      ))}
      <div className="sb-spacer" />
      {FOOT.map((n) => (
        <NavLink key={n.page} n={n} lit={route.page === n.page} onNavigate={onNavigate} />
      ))}
      <Vitals overview={overview} onOpenVoice={onOpenVoice} />
    </nav>
  )
}

// The phone layout's bottom bar: the same five pages, always one thumb away. The drawer
// above still carries Docs, Activity and the vitals.
export function TabBar({ route }) {
  return (
    <nav className="tabbar" aria-label="Console pages">
      {NAV.map((n) => (
        <a
          key={n.page}
          href={n.hash}
          className={route.page === n.page ? 'on' : ''}
          aria-current={route.page === n.page ? 'page' : undefined}
        >
          <Icon name={n.icon} />
          {n.label}
        </a>
      ))}
    </nav>
  )
}
