import React, { useEffect, useState } from 'react'
import { api } from '../api/index.js'
import { Icon } from '../components/Icon.jsx'
import { relTime } from '../lib/format.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'

// Status → badge variant + label + left-accent colour. busy = working,
// waiting-input = your move, blocked = stuck on a permission, idle = quiet.
// Only four badge variants exist, so blocked reuses `bad` (the "needs you / stuck"
// red) — distinct from `warn` (your move) and the dim idle.
const STATUS = {
  busy: { cls: 'acc', label: 'working', accent: 'var(--accent)' },
  'waiting-input': { cls: 'warn', label: 'your move', accent: 'var(--warn)' },
  blocked: { cls: 'bad', label: 'blocked', accent: 'var(--bad)' },
  idle: { cls: '', label: 'idle', accent: 'var(--line)' },
}

const ELLIPSIS = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

// Last path segment of a working dir — the card's heading when a session has no
// title yet; the full path rides below it, muted.
function baseName(p) {
  if (!p) return ''
  const parts = p.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || p
}

const compact = (n) =>
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

// Live turn-elapsed: ticks each second from the turn's start (epoch seconds). The
// 2s poll updates the rest; this keeps the clock smooth without re-fetching.
function Elapsed({ startedAt }) {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(t)
  }, [])
  return fmtElapsed(now - startedAt)
}

function TodoStrip({ done, total }) {
  const n = Math.min(total, 10)
  const filled = Math.min(n, Math.round((done / total) * n))
  return (
    <span style={{ letterSpacing: 2 }}>
      <span style={{ color: 'var(--accent)' }}>{'●'.repeat(filled)}</span>
      <span style={{ color: 'var(--text-3)' }}>{'○'.repeat(n - filled)}</span>
    </span>
  )
}

function SessionCard({ s }) {
  const st = STATUS[s.status] || STATUS.idle
  const files = s.files
  const todos = s.todos
  const hasFooter = (todos && todos.total > 0) || s.error || s.blocked_on
  return (
    <div className="card pad-md" style={{ borderLeft: `3px solid ${st.accent}` }}>
      <div className="row between wrap gap-12">
        <div className="row gap-10" style={{ minWidth: 0 }}>
          <span className={`feed-dot ${st.cls || 'acc'}`} style={{ width: 9, height: 9 }} />
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0 }}>{s.title || baseName(s.cwd) || s.session_id}</h3>
            {s.cwd && (
              <div className="dim mono" style={{ fontSize: 12, ...ELLIPSIS }} title={s.cwd}>
                {s.cwd}
              </div>
            )}
          </div>
        </div>
        <div className="row gap-8" style={{ flexShrink: 0 }}>
          {s.model && (
            <span className="badge mono" title="model">
              {s.model}
            </span>
          )}
          {s.agent && <span className="badge">{s.agent}</span>}
          <span className={`badge ${st.cls}`}>
            <span className="dot" />
            {st.label}
          </span>
        </div>
      </div>

      {s.phase && (
        <div className="row gap-8" style={{ marginTop: 10, fontSize: 14 }}>
          <Icon name="activity" />
          <span style={ELLIPSIS}>{s.phase}</span>
        </div>
      )}

      {(s.tokens > 0 || s.cost > 0 || s.turn_started_at || (files && files.count > 0)) && (
        <div className="row wrap" style={{ gap: 16, marginTop: 12, fontSize: 13, color: 'var(--text-2)' }}>
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
              <span style={{ color: 'var(--good)' }}>+{files.additions}</span>{' '}
              <span style={{ color: 'var(--bad)' }}>−{files.deletions}</span>
            </span>
          )}
        </div>
      )}

      {hasFooter && (
        <div
          className="row between wrap gap-12"
          style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)' }}
        >
          {todos && todos.total > 0 ? (
            <span className="row gap-8 dim" style={{ fontSize: 13 }}>
              <TodoStrip done={todos.done} total={todos.total} />
              plan {todos.done}/{todos.total}
            </span>
          ) : (
            <span />
          )}
          {s.error ? (
            <span className="badge bad" title={s.error} style={{ maxWidth: 300, ...ELLIPSIS }}>
              {s.error}
            </span>
          ) : s.blocked_on ? (
            <span className="badge bad" title={s.blocked_on} style={{ maxWidth: 300, ...ELLIPSIS }}>
              {s.blocked_on}
            </span>
          ) : null}
        </div>
      )}

      <div className="dim mono" style={{ fontSize: 11, marginTop: 8 }}>
        updated {relTime(s.updated_at)} ago
      </div>
    </div>
  )
}

export default function Activity() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  // No page polled before this one — mirror the setInterval + cleanup shape from
  // hooks/useJobs.js. 2s is plenty for a glanceable HUD; a failed poll is held (the
  // next tick recovers) so a momentary blip doesn't blank the view.
  useEffect(() => {
    let alive = true
    const tick = () =>
      api.activity().then(
        (d) => {
          if (alive) {
            setData(d)
            setError('')
          }
        },
        (e) => {
          if (alive) setError(e.message)
        },
      )
    tick()
    const t = setInterval(tick, 2000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  // Default on when the field is absent (older server / first paint).
  const enabled = data ? data.enabled !== false : true
  const sessions = data?.activity || []

  const toggle = async () => {
    const next = !enabled
    try {
      const res = await api.activityToggle(next)
      // Optimistic: reflect the flip now; the next poll reconciles from disk.
      setData((d) => ({ ...(d || {}), enabled: res.enabled, activity: res.enabled ? d?.activity || [] : [] }))
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="narrow">
      <div className="head-row mb-16">
        <div>
          <h1 className="h">Activity</h1>
          <p className="sub">
            Live OpenCode sessions this harness is running — what each one is doing right now.
            Refreshes every couple of seconds; sessions drop off when their process exits.
          </p>
        </div>
        <div className="row gap-10" style={{ alignItems: 'center', flexShrink: 0 }}>
          <span className="dim mono" style={{ fontSize: 12 }}>
            {enabled ? 'tracking on' : 'tracking off'}
          </span>
          <div
            className={`sw-toggle${enabled ? ' on' : ''}`}
            role="switch"
            aria-checked={enabled}
            aria-label="Toggle activity tracking"
            tabIndex={0}
            onClick={toggle}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                if (e.key === ' ') e.preventDefault()
                toggle()
              }
            }}
          />
        </div>
      </div>
      <ErrorState error={error} style={{ marginBottom: 12 }} />
      {!data ? (
        <Loading label="Reading live sessions…" />
      ) : !enabled ? (
        <div className="empty">
          <div className="big">Activity tracking is off</div>
          The plugin isn&apos;t recording sessions. Flip the switch to turn it back on.
        </div>
      ) : sessions.length === 0 ? (
        <div className="empty">
          <div className="big">No active sessions</div>
          Run <code>opencode</code> and the sessions it spins up appear here.
        </div>
      ) : (
        <div className="stack gap-12">
          {sessions.map((s) => (
            <SessionCard key={s.session_id} s={s} />
          ))}
        </div>
      )}
    </div>
  )
}
