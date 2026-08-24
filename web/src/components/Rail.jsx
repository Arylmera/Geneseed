import React from 'react'
import { go } from '../lib/router.js'
import { editCount, readiness, relTime } from '../lib/format.js'
import { Icon, Sprout } from './Icon.jsx'

// Left navigation rail, grouped like the design: the Dashboard on its own, then
// Codex (what the harness knows and is bound by), Care (what needs attention)
// and Setup (what you configure). `match` decides which item lights up for the
// current route; `tag` surfaces a live count or status from the overview.
//
// EVERY TAG READS THE OVERVIEW, and the ones the design asked for that it cannot
// are simply absent. The mockup badged Docs, Graph and Activity too — none of the
// three has a number on `/api/overview` (docs and the graph are their own fetches;
// the activity flag lives on `/api/activity`), and the rail renders on every page,
// so buying three badges with three extra round-trips per page load is a bad
// trade for decoration. A missing badge costs nothing; an invented one is a lie
// the user cannot check.
//
// Library and Docs no longer expand into nested sub-menus here — both pages own
// their own horizontal chip-bar for in-page sub-navigation now.
const NAV = [
  {
    hash: '#/',
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'dashboard',
    match: (r) => r.view === 'dashboard',
    // Not a count — the field journal's own name for itself. It is the one row
    // whose tag says what the page IS rather than how much it holds.
    tag: () => 'today',
  },
  { group: 'Codex' },
  {
    hash: '#/laws',
    id: 'laws',
    label: 'Constitution',
    icon: 'law',
    match: (r) =>
      r.view === 'laws' ||
      (r.view === 'section' && r.section === 'laws') ||
      (r.view === 'item' && r.type === 'law'),
    tag: (o) => o?.counts?.laws ?? null,
  },
  {
    // The user's own standing rules (user-rules.md) — deliberately right under
    // Laws so the pairing reads at a glance: Laws are Geneseed's, Rules are yours.
    hash: '#/rules',
    id: 'rules',
    label: 'Rules',
    icon: 'rule',
    match: (r) => r.view === 'rules',
  },
  {
    // The user's identity (PROFILE.md) — sits by Rules: Rules are what you must do,
    // the Profile is who you are. Both files are yours, seeded once and never wiped.
    hash: '#/profile',
    id: 'profile',
    label: 'Profile',
    icon: 'profile',
    match: (r) => r.view === 'profile',
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
    hash: '#/agents',
    id: 'agents',
    label: 'Agents',
    icon: 'agent',
    match: (r) =>
      r.view === 'agents' ||
      (r.view === 'section' && r.section === 'agents') ||
      (r.view === 'item' && r.type === 'agent'),
    tag: (o) => o?.counts?.agents ?? null,
  },
  {
    hash: '#/library',
    id: 'library',
    label: 'Library',
    icon: 'library',
    // Laws, Skills, and Agents own their item/section routes (matched above); the
    // Library tab claims every other section/item so its highlight doesn't steal theirs.
    match: (r) =>
      r.view === 'library' ||
      (r.view === 'section' && !['laws', 'skills', 'agents'].includes(r.section)) ||
      (r.view === 'item' && !['law', 'skill', 'agent'].includes(r.type)),
    // The four sections the page actually lists — memory, notebook, wiki, and the
    // config manifests folded into the wiki chip. NOT `SECTION_ORDER`, which also
    // counts agents: those have their own row two lines up, and counting them here
    // would make the two badges overlap on the same items.
    tag: (o) =>
      o?.counts
        ? (o.counts.memory ?? 0) +
          (o.counts.notebook ?? 0) +
          (o.counts.wiki ?? 0) +
          (o.counts.config ?? 0)
        : null,
  },
  {
    hash: '#/docs',
    id: 'docs',
    label: 'Docs',
    icon: 'docs',
    match: (r) => r.view === 'docs',
  },
  { hash: '#/graph', id: 'graph', label: 'Graph', icon: 'graph', match: (r) => r.view === 'graph' },
  { group: 'Care' },
  {
    hash: '#/activity',
    id: 'activity',
    label: 'Activity',
    icon: 'activity',
    match: (r) => r.view === 'activity' || r.view === 'activity-detail',
  },
  {
    hash: '#/diff',
    id: 'changes',
    label: 'Changes',
    icon: 'changes',
    match: (r) => r.view === 'diff',
    tag: (o) => (o?.diff ? editCount(o.diff) : null) || null,
  },
  {
    hash: '#/doctor',
    id: 'doctor',
    label: 'Doctor',
    icon: 'doctor',
    match: (r) => r.view === 'doctor',
    // Status-bearing, not count-bearing: a clean doctor used to badge NOTHING, which
    // reads the same as "never run". It now says so in words, and only the failing
    // arm takes the warn colour.
    tag: (o) => (!o?.doctor ? null : o.doctor.ok ? 'clean' : o.doctor.problems.length),
    warn: (o) => !!o?.doctor && !o.doctor.ok,
  },
  { group: 'Setup' },
  {
    // Harnesses + Themes merged here; `#/harnesses` and `#/themes` both resolve to
    // this view (router.js's VIEW_ALIAS), so old links and bookmarks still land.
    hash: '#/harness',
    id: 'harness',
    label: 'Harness',
    icon: 'layers',
    match: (r) => r.view === 'harness',
    tag: (o) => o?.theme ?? null,
  },
  {
    // About folded in at the bottom of this page, so the rail's old one-item
    // "About" group is gone.
    hash: '#/settings',
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    match: (r) => r.view === 'settings',
  },
]

// The germination dial at rail scale, drawn here rather than reusing Dashboard's
// `Ring`: that one's 48-tick bezel is laid out at `r - 18` and `r - 24`, which
// are both negative below about a 120px box — it is a hero component and does not
// shrink. This is the same number, in the mockup's 72-unit box.
function VitalsRing({ value }) {
  const r = 30
  const c = 2 * Math.PI * r
  return (
    <svg
      className="rv-ring"
      width="66"
      height="66"
      viewBox="0 0 72 72"
      role="img"
      aria-label={`Growth ${Math.round(value * 100)} of 100`}
    >
      <circle cx="36" cy="36" r={r} fill="none" stroke="var(--line-2)" strokeWidth="6" />
      <circle
        cx="36"
        cy="36"
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${c * value} ${c}`}
        transform="rotate(-90 36 36)"
        style={{ transition: 'stroke-dasharray 1.1s cubic-bezier(.2,.7,.2,1)' }}
      />
      <text className="rv-ring-num" x="36" y="34" textAnchor="middle">
        {Math.round(value * 100)}
      </text>
      <text className="rv-ring-lbl" x="36" y="47" textAnchor="middle">
        GROWTH
      </text>
    </svg>
  )
}

// The harness's pulse, above the index and therefore on every page: how grown it
// is, how far it has drifted, whether the doctor is happy, and when it was last
// built. Four facts that decide whether anything else on screen can be trusted.
//
// It needs `setup` as well as `overview` because a fifth of the germination score
// is "the deployed fingerprint matches the source" — App fetches it once and hands
// it to both this and the Dashboard. Hidden at the 960px icon-collapse: there is
// no room for it in a 62px strip, and the breakpoint contract forbids a fourth.
function RailVitals({ overview, setup }) {
  if (!overview) return null
  const doctor = !overview.doctor
    ? '—'
    : overview.doctor.ok
      ? 'clean'
      : `${overview.doctor.problems.length} to fix`
  return (
    <div className="rail-vitals">
      <VitalsRing value={readiness(overview, setup)} />
      <div className="rv-rows">
        <div>
          <span>Drift</span>
          <b>{editCount(overview.diff)}</b>
        </div>
        <div>
          <span>Doctor</span>
          <b>{doctor}</b>
        </div>
        <div>
          <span>Built</span>
          {/* The relative label, from `build_epoch` — the rail is 232px wide and
              "2026-08-23 16:09" does not fit beside a 66px ring. The full stamp is on
              the Harness page, where there is room for the precise fact. */}
          <b className="plain" title={overview.build_time || undefined}>
            {overview.build_epoch ? relTime(overview.build_epoch) : 'never'}
          </b>
        </div>
      </div>
    </div>
  )
}

export default function Rail({ route, overview, setup, onOpenVoice, onNavigate }) {
  return (
    <aside className="rail" id="rail-nav" aria-label="Harness navigation">
      <button
        className="rail-brand"
        onClick={() => {
          go('#/')
          onNavigate?.()
        }}
        title="Dashboard"
      >
        <Sprout />
        <div className="brand-text">
          <span className="brand-name">
            Gene<b>seed</b>
          </span>
          <span className="brand-sub">harness console</span>
        </div>
      </button>
      <RailVitals overview={overview} setup={setup} />
      {NAV.map((n, i) => {
        if (n.group)
          return (
            <div className="rail-group" key={'g' + i}>
              {n.group}
            </div>
          )
        const tag = n.tag ? n.tag(overview) : null
        const lit = n.match(route)
        const warn = typeof n.warn === 'function' ? n.warn(overview) : !!n.warn
        return (
          <div className="rail-nav" key={n.id}>
            <a
              className={`rail-item ${lit ? 'active' : ''}`}
              href={n.hash}
              aria-current={lit ? 'page' : undefined}
              title={n.label}
              onClick={() => onNavigate?.()}
            >
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {tag ? (
                <span className="tag" style={warn ? { color: 'var(--warn)' } : null}>
                  {tag}
                </span>
              ) : null}
            </a>
          </div>
        )
      })}
      <div className="rail-spacer" />
      <div className="rail-foot">
        <button className="voice" onClick={onOpenVoice} title="Switch deployed voice">
          <span className="voice-orb" />
          <div className="voice-meta">
            <div className="vk">deployed voice</div>
            <div className="vv">{overview?.theme || '—'}</div>
          </div>
          <Icon name="chevron" className="chev glyph" />
        </button>
      </div>
    </aside>
  )
}
