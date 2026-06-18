import React, { useEffect, useState } from 'react'
import { api } from '../api/index.js'
import { Icon } from '../components/Icon.jsx'
import { go } from '../lib/router.js'
import { relTime } from '../lib/format.js'
import { STATUS, ELLIPSIS, baseName, compact, Elapsed, TodoStrip } from '../lib/activity.jsx'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'

function SessionCard({ s }) {
  const st = STATUS[s.status] || STATUS.idle
  const files = s.files
  const todos = s.todos
  const hasFooter = (todos && todos.total > 0) || s.error || s.blocked_on
  const open = () => go(`#/activity/${encodeURIComponent(s.session_id)}`)
  return (
    <div
      className="card pad-md act-card"
      style={{ borderLeft: `3px solid ${st.accent}`, cursor: 'pointer' }}
      onClick={open}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') open()
      }}
    >
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
          {/* affordance: this card opens the session detail (the card itself is the link) */}
          <Icon name="chevron" className="glyph act-chev" />
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
