import React from 'react'
import { go } from '../lib/router.js'
import { libraryCount, ruleCount } from '../lib/format.js'
import { Icon, Sprout } from './Icon.jsx'
import { useLocalStorage } from '../hooks/useLocalStorage.js'

// The pages, in the order a visit reads them. The rail groups them (GROUPS below): the Overview
// alone, then what governs, what is built, what runs, and help. A badge is what
// its page lists, across every install, deduped (`overview.counts`; __tests__/railCounts.test.jsx
// holds each one to its page); a page with no honest single number carries none.
const NAV = [
  { group: 'core', hash: '#/', page: 'overview', label: 'Overview', icon: 'dashboard' },
  {
    group: 'govern',
    hash: '#/laws',
    page: 'laws',
    label: 'Constitution',
    icon: 'law',
    count: (o) => (o?.counts ? ruleCount(o.counts) : null),
  },
  {
    group: 'build',
    hash: '#/library',
    page: 'library',
    label: 'Library',
    icon: 'library',
    count: (o) => (o?.counts ? libraryCount(o.counts) : null),
  },
  {
    group: 'build',
    hash: '#/kits',
    page: 'kits',
    label: 'Kits',
    icon: 'kit',
  },
  // Templates only: a brick is a part, the template is what a person runs.
  {
    group: 'build',
    hash: '#/loops',
    page: 'loops',
    label: 'Loops',
    icon: 'loop',
    // The union across installs, by the owner's ruling; the page lists the picked install's.
    countTitle: 'Templates across every install',
    count: (o) => o?.counts?.loops ?? null,
  },
  // No badge: the overview counts no factories, and a rail count must be what its page lists.
  { group: 'build', hash: '#/factories', page: 'factories', label: 'Factories', icon: 'build' },
  { group: 'govern', hash: '#/personal', page: 'personal', label: 'Personal', icon: 'profile' },
  {
    group: 'run',
    hash: '#/installs',
    page: 'installs',
    label: 'Installs',
    icon: 'layers',
    // What is installed, on or off: a host row with nothing on it is an offer, not an install.
    count: (o, installs) => (installs ? installs.filter((i) => i.state !== 'absent').length : null),
  },
]

const FOOT = [
  { group: 'help', hash: '#/docs', page: 'docs', label: 'Docs', icon: 'docs' },
  { group: 'run', hash: '#/activity', page: 'activity', label: 'Activity', icon: 'activity' },
  { group: 'help', hash: '#/settings', page: 'settings', label: 'Settings', icon: 'settings' },
]

// The rail's groups, in order. `tint` names the --sb-<tint>-bg / -ink pair in styles.css; the
// Overview stands alone, so it has no header. Every page belongs to exactly one group.
const GROUPS = [
  { id: 'core', title: null },
  { id: 'govern', title: 'Govern' },
  { id: 'build', title: 'Build' },
  { id: 'run', title: 'Run' },
  { id: 'help', title: 'Help' },
]
const ALL = [...NAV, ...FOOT]
const COLLAPSE_KEY = 'geneseed-rail'

function NavLink({ n, lit, count, collapsed, onNavigate }) {
  return (
    <li>
      <a
        className={`sb-item${lit ? ' on' : ''}`}
        href={n.hash}
        aria-current={lit ? 'page' : undefined}
        title={collapsed ? n.label : undefined}
        aria-label={collapsed ? (count != null ? `${n.label}, ${count}` : n.label) : undefined}
        onClick={() => onNavigate?.()}
      >
        <span className="sb-chip" aria-hidden="true">
          <Icon name={n.icon} />
        </span>
        <span className="sb-label">{n.label}</span>
        {count != null ? (
          <span className="sb-count" title={n.countTitle}>
            {count}
          </span>
        ) : null}
      </a>
    </li>
  )
}

export default function Sidebar({ route, overview, installs, onNavigate }) {
  // Per viewer. Only the desktop rail honours it: the tablet tier is always chips, and the phone
  // drawer always full (styles.css), so the toggle is hidden there.
  const [rail, setRail] = useLocalStorage(COLLAPSE_KEY, (v) =>
    v === 'collapsed' ? 'collapsed' : 'open',
  )
  const collapsed = rail === 'collapsed'
  const toggle = () => setRail(collapsed ? 'open' : 'collapsed')
  const toggleLabel = collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'
  return (
    // A <nav> landmark: this IS the app's primary navigation, and tabIndex -1 lets the
    // phone drawer's focus management in App.jsx move focus here.
    <nav
      className={`sidebar${collapsed ? ' collapsed' : ''}`}
      id="rail-nav"
      aria-label="Console"
      tabIndex={-1}
    >
      <div className="sb-head">
        <button
          type="button"
          className="sb-collapse"
          onClick={toggle}
          aria-label={toggleLabel}
          title={toggleLabel}
          aria-expanded={!collapsed}
        >
          <Icon name="chevron" />
        </button>
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
      </div>
      {GROUPS.map((g) => (
        <div
          key={g.id}
          className={`sb-group sb-${g.id}`}
          role="group"
          aria-labelledby={g.title ? `sb-g-${g.id}` : undefined}
          aria-label={g.title ? undefined : 'Overview'}
        >
          {g.title ? (
            <div className="sb-group-title" id={`sb-g-${g.id}`}>
              <i aria-hidden="true" />
              {g.title}
            </div>
          ) : null}
          <ul className="sb-list">
            {ALL.filter((n) => n.group === g.id).map((n) => (
              <NavLink
                key={n.page}
                n={n}
                lit={route.page === n.page}
                count={n.count?.(overview, installs)}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

// The phone tab bar's four pages; every other page is behind More.
const TABBED = ['overview', 'laws', 'library', 'installs']

// The phone layout's bottom bar: the four pages a visit starts from, at their full names
// (five cells fit "Constitution" at 360px; eight did not), and More, which opens the drawer
// holding every page, Docs and Activity. More is lit on a page only it reaches.
export function TabBar({ route, navOpen, onMore }) {
  return (
    <nav className="tabbar" aria-label="Console pages">
      {NAV.filter((n) => TABBED.includes(n.page)).map((n) => (
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
      <button
        type="button"
        className={`tab-more${TABBED.includes(route.page) ? '' : ' on'}`}
        aria-controls="rail-nav"
        aria-expanded={!!navOpen}
        onClick={onMore}
      >
        <Icon name="menu" />
        More
      </button>
    </nav>
  )
}
