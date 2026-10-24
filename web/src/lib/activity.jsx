import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { animate, utils } from 'animejs'
import { Icon } from '../components/Icon.jsx'
import { motionOK, settle } from './motion.js'
import { newestJobs } from './jobBuckets.js'

// Shared render vocabulary for the Activity list (cards) and the session-detail page.

// Status → badge variant + label + left-accent colour. Only four badge variants exist,
// so blocked reuses `bad` (the "stuck / needs you" red) — distinct from `warn` (your
// move) and the dim idle.
export const STATUS = {
  busy: { cls: 'acc', label: 'working', accent: 'var(--accent)' },
  'waiting-input': { cls: 'warn', label: 'your move', accent: 'var(--warn)' },
  blocked: { cls: 'bad', label: 'blocked', accent: 'var(--bad)' },
  idle: { cls: '', label: 'idle', accent: 'var(--line)' },
}

// Last path segment of a working dir — the heading when a session has no title yet.
export function baseName(p) {
  if (!p) return ''
  const parts = p.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || p
}

// 48213 → "48.2k", 250000 → "250k", 1.2e6 → "1.2M".
//
// Hand-rolled rather than Intl.NumberFormat({notation:'compact'}): Intl drops the forced
// decimal on round values (5000 → "5K" not "5.0k") and compacts negatives (-5000 → "-5K"
// instead of falling into the n<1000 branch as "-5000"). Worse, at the k/M boundary Intl
// picks its unit from the rounded value, not the raw one, so 999950 comes out "1M" where
// this always said "1000k" — a real behaviour change Intl's options can't undo. See
// docs/specs/2026-08-26-ponytail-refactor-tranches.md Self-improvement table.
export const compact = (n) =>
  !n
    ? '0'
    : n < 1000
      ? String(n)
      : n < 1e5
        ? (n / 1000).toFixed(1) + 'k'
        : n < 1e6
          ? (n / 1000).toFixed(0) + 'k'
          : (n / 1e6).toFixed(1) + 'M'

function fmtElapsed(sec) {
  sec = Math.max(0, Math.floor(sec))
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}m ${sec % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

// Live turn-elapsed: ticks each second from the turn's start (epoch seconds).
export function Elapsed({ startedAt }) {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(t)
  }, [])
  return fmtElapsed(now - startedAt)
}

export function TodoStrip({ done, total }) {
  const n = Math.min(total, 10)
  const filled = Math.min(n, Math.round((done / total) * n))
  return (
    <span className="act-todo">
      <span className="on">{'●'.repeat(filled)}</span>
      <span className="dim">{'○'.repeat(n - filled)}</span>
    </span>
  )
}

// Whether SessionHeader draws its counters row: the card's aria-describedby points at that
// row, so both must ask the same question or the link describes itself by a missing id.
export const hasCounters = (s) =>
  !!(s.tokens > 0 || s.cost > 0 || s.turn_started_at || s.files?.count > 0)

// The session's state block, shared by the list card and the detail page so the two
// cannot drift (the detail once lacked the churn the card showed). `heading` is the card's
// title: the detail page puts its title in PageHeader instead. `id` prefixes the ids the
// card link names itself by (`-t` title, `-st` status, `-c` counters); `children` trail
// the badges (the card's chevron).
export function SessionHeader({ s, heading, id, children }) {
  const st = STATUS[s.status] || STATUS.idle
  const files = s.files
  const counters = hasCounters(s)
  const ref = (k) => (id ? `${id}-${k}` : undefined)
  return (
    <>
      <div className="row between wrap gap-12">
        {heading ? (
          <div className="row gap-10 act-min">
            <span className={`feed-dot act-dot ${st.cls || 'acc'}`} />
            <div className="act-min">
              <h2 className="act-title" id={ref('t')}>
                {heading}
              </h2>
              {s.cwd && (
                <div className="dim mono act-cwd" title={s.cwd}>
                  {s.cwd}
                </div>
              )}
            </div>
          </div>
        ) : null}
        <div className="row gap-8 act-fixed">
          {s.model && (
            <span className="badge mono" title="model">
              {s.model}
            </span>
          )}
          {s.agent && <span className="badge">{s.agent}</span>}
          <span className={`badge ${st.cls}`} id={ref('st')}>
            <span className="dot" />
            {st.label}
          </span>
          {children}
        </div>
      </div>

      {s.phase && (
        <div className="row gap-8 act-phase">
          <Icon name="activity" />
          <span className="act-ell">{s.phase}</span>
        </div>
      )}

      {counters && (
        <div className="row wrap act-counters" id={ref('c')}>
          {s.tokens > 0 && <span>{compact(s.tokens)} tok</span>}
          {s.cost > 0 && <span>${s.cost.toFixed(2)}</span>}
          {s.turn_started_at ? (
            <span>
              <Elapsed startedAt={s.turn_started_at} />
            </span>
          ) : null}
          {files && files.count > 0 && (
            <span>
              {files.count} file{files.count === 1 ? '' : 's'}{' '}
              <span className="t-good">+{files.additions}</span>{' '}
              <span className="t-bad">−{files.deletions}</span>
            </span>
          )}
        </div>
      )}

      {(s.error || s.blocked_on) && (
        <div className="act-err-row">
          <span className="badge bad act-ell" title={s.error || s.blocked_on}>
            {s.error || s.blocked_on}
          </span>
        </div>
      )}
    </>
  )
}

// Both states wait on the user: blocked on an approval, or waiting for an answer. One
// predicate, so the "Waiting on you" count and the "Needs you" filter cannot disagree.
export const needsYou = (s) => s?.status === 'blocked' || s?.status === 'waiting-input'

const DAY_MS = 86400000

// A UTC calendar day, `YYYY-MM-DD`. UTC because the gate ledger's per_day is UTC: one key
// lets a run and a gate ask land in the same day group.
export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10)

const fromKey = (key, opts) =>
  new Date(`${key}T00:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' })
export const shortDay = (key) => fromKey(key, { day: 'numeric', month: 'short' })

// "Today · Saturday 24 October", "Yesterday · …", else "Tuesday 20 October".
export function dayLabel(key, now = Date.now()) {
  const long = fromKey(key, { weekday: 'long', day: 'numeric', month: 'long' })
  const rel = key === dayKey(now) ? 'Today' : key === dayKey(now - DAY_MS) ? 'Yesterday' : ''
  return rel ? `${rel} · ${long}` : long
}

// Runs per UTC day over the last `days` days, oldest first: `[{ key, n, nodata }]`.
// Calendar days, not bucketJobsByDay's rolling 24 h, and with a no-data flag: the server keeps
// only the newest `cap` finished runs, so a zero before the oldest kept run is a zero nobody
// can prove once the log may have been trimmed. With `cap` unknown, assume it was.
export function runDays(jobs, { now = Date.now(), days = 14, cap } = {}) {
  const list = (jobs || []).filter((j) => Number.isFinite(j.started))
  const count = {}
  for (const j of list) {
    const k = dayKey(j.started * 1000)
    count[k] = (count[k] || 0) + 1
  }
  const oldest = list.length ? dayKey(Math.min(...list.map((j) => j.started)) * 1000) : null
  const finished = list.filter((j) => j.status !== 'running').length
  const trimmed = typeof cap === 'number' ? finished >= cap : true
  return Array.from({ length: days }, (_, i) => {
    const key = dayKey(now - (days - 1 - i) * DAY_MS)
    return { key, n: count[key] || 0, nodata: trimmed && (oldest === null || key < oldest) }
  })
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// The feed: one group per UTC day that has a run or a gate ask, newest day first. `rows` are
// gateRows() output (per_day aligned with `days`, the ledger's keys). A day's gate asks fold
// into ONE line, busiest rule first: the ledger keeps counts per day, not each ask.
export function feedDays(jobs, rows, days, now = Date.now()) {
  const by = {}
  const day = (key) => (by[key] ||= { key, runs: [], asks: [] })
  for (const j of newestJobs(jobs, (jobs || []).length)) {
    if (Number.isFinite(j.started)) day(dayKey(j.started * 1000)).runs.push(j)
  }
  ;(days || []).forEach((key, i) => {
    for (const r of rows || []) if (r.per_day?.[i] > 0) day(key).asks.push([r.name, r.per_day[i]])
  })
  return Object.values(by)
    .sort((a, b) => (a.key < b.key ? 1 : -1))
    .map(({ key, runs, asks }) => {
      asks.sort((a, b) => b[1] - a[1])
      const n = asks.reduce((s, a) => s + a[1], 0)
      const title = asks.map(([name, c], i) => `${name}${i ? '' : ' asked'} ${c}×`).join(', ')
      const sum = [runs.length && plural(runs.length, 'run'), n && plural(n, 'gate ask')]
      return {
        key,
        title: dayLabel(key, now),
        sum: sum.filter(Boolean).join(' · '),
        runs,
        gate: n ? { title, n } : null,
      }
    })
}

const SWEEP_MS = 500

// A 30-day sparkline, moved here from the Ledger so Activity draws the same one. With
// `sweep`, the line draws itself in once per change of its values (keyed like StackBar's
// `sig`, so a re-render with the same numbers does not redraw). The markup is final: without
// motion (reduced motion, a test) the line is simply there.
export function Spark({ vals, i, sweep = false }) {
  const line = useRef(null)
  const sig = vals.join(',')
  useLayoutEffect(() => {
    if (!sweep || !line.current || !motionOK()) return
    // Undrawn before paint (a layout effect), so the full line never flashes first.
    utils.set(line.current, { strokeDasharray: 1, strokeDashoffset: 1 })
    return settle(
      animate(line.current, { strokeDashoffset: [1, 0], duration: SWEEP_MS, ease: 'outExpo' }),
      SWEEP_MS,
    )
  }, [sig, sweep])
  const w = 96
  const h = 22
  const max = Math.max(1, ...vals)
  const step = w / (vals.length - 1)
  const pts = vals.map(
    (v, d) => `${(d * step).toFixed(1)},${(h - 2 - (v / max) * (h - 5)).toFixed(1)}`,
  )
  const [lx, ly] = pts[pts.length - 1].split(',')
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ '--i': i }}>
      <polyline points={`0,${h - 1} ${w},${h - 1}`} className="spk-base" />
      <polygon className="spk-area" points={`0,${h - 1} ${pts.join(' ')} ${w},${h - 1}`} />
      <polyline className="spk-line" pathLength="1" points={pts.join(' ')} ref={line} />
      <circle className="spk-end" cx={lx} cy={ly} r="2.4" />
    </svg>
  )
}

// Grows every `[data-sweep]` child of the returned ref's box from zero along one axis
// (`scaleY` for the run columns, `scaleX` for the duration bars), once per change of `sig`.
// Sizes stay final in the markup, so without motion the bars are simply there.
export function useSweep(sig, prop) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const kids = ref.current ? [...ref.current.querySelectorAll('[data-sweep]')] : []
    if (!kids.length || !motionOK()) return
    utils.set(kids, { [prop]: 0 })
    return settle(animate(kids, { [prop]: [0, 1], duration: SWEEP_MS, ease: 'outExpo' }), SWEEP_MS)
  }, [sig, prop])
  return ref
}
