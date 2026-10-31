import React from 'react'
import { go } from '../lib/router.js'
import { driftTotal, relTime } from '../lib/format.js'
import { Icon, Sprout } from './Icon.jsx'
import { activeInstalls, installTag } from '../lib/hosts.js'

// The seven pages, in the order a visit reads them: how the harness is doing, what it
// obeys, what it knows, how it iterates, what is yours, and where it is installed. Each count reads data
// the shell already holds (the overview and the installs list); a page with no honest
// single number carries none rather than an invented one.
const NAV = [
  { hash: '#/', page: 'overview', label: 'Overview', icon: 'dashboard' },
  {
    hash: '#/laws',
    page: 'laws',
    label: 'Constitution',
    icon: 'law',
    // Every entry the page lists: the ethos sections, the invariants (a retired one an older
    // install still lists is counted too), and the doctrine rules.
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
  {
    hash: '#/kits',
    page: 'kits',
    label: 'Kits',
    icon: 'kit',
  },
  // Templates only: a brick is a part, the template is what a person runs.
  {
    hash: '#/loops',
    page: 'loops',
    label: 'Loops',
    icon: 'loop',
    count: (o) => o?.counts?.loops ?? null,
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
    <li>
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
    </li>
  )
}

// The harness's pulse, on every page: whether the doctor is happy, how far the install
// has drifted from its source, and when it was built. Three facts that decide whether
// anything else on screen can be trusted. The voice sits under them as a button, because
// switching it is the one rebuild the sidebar offers. A named card (a region), so a
// landmark list reaches it by name. Its facts are ONE install's (the default's overview): once
// two installs are active, `tag` names it, on the card and in its name.
function Vitals({ overview, onOpenVoice, tag }) {
  if (!overview) return null
  const d = overview.doctor
  const drift = driftTotal(overview.diff)
  return (
    <section className="sb-vitals" aria-label={tag ? `Install vitals, ${tag}` : 'Install vitals'}>
      {tag ? (
        <div>
          <span>install</span>
          <b className="mono">{tag}</b>
        </div>
      ) : null}
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
      <button
        type="button"
        className="sb-voice"
        onClick={onOpenVoice}
        title="Switch voice"
        aria-haspopup="dialog"
      >
        <span className="sb-voice-name">
          <i className="sb-voice-swatch" aria-hidden="true" />
          Voice · {overview.theme || 'none'}
          {tag ? ` · ${tag}` : ''}
        </span>
        <Icon name="chevron" />
      </button>
    </section>
  )
}

export default function Sidebar({ route, overview, installs, onOpenVoice, onNavigate }) {
  const tag =
    activeInstalls(installs).length > 1 && overview?.install ? installTag(overview.install) : null
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
            {[overview?.version && `v${overview.version}`, overview?.theme, tag]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
      </button>
      {/* One list of every page, Docs and Activity last: the spacer sits under it, so the
          vitals card is what the rail's foot holds. */}
      <ul className="sb-list">
        {[...NAV, ...FOOT].map((n) => (
          <NavLink
            key={n.page}
            n={n}
            lit={route.page === n.page}
            count={n.count?.(overview, installs)}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
      <div className="sb-spacer" />
      {/* The tablet rail (721-960px) is icons only and hides the vitals, voice included;
          this icon is the voice switch there. CSS shows it in that tier only. */}
      {overview ? (
        <button
          type="button"
          className="sb-voice-rail"
          aria-label={`Switch voice, now ${overview.theme || 'none'}`}
          title="Switch voice"
          onClick={onOpenVoice}
        >
          <Icon name="spark" />
        </button>
      ) : null}
      <Vitals overview={overview} onOpenVoice={onOpenVoice} tag={tag} />
    </nav>
  )
}

// The phone tab bar's four pages; every other page is behind More.
const TABBED = ['overview', 'laws', 'library', 'installs']

// The phone layout's bottom bar: the four pages a visit starts from, at their full names
// (five cells fit "Constitution" at 360px; eight did not), and More, which opens the drawer
// holding every page, Docs, Activity and the vitals. More is lit on a page only it reaches.
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
