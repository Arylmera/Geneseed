import React, { useEffect, useState } from 'react'
import { Icon } from '../components/Icon.jsx'

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
