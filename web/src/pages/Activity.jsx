import React, { useEffect, useState } from 'react'
import { api } from '../api/index.js'
import { Icon } from '../components/Icon.jsx'
import { relTime } from '../lib/format.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'

// Status → badge variant + label. busy = working, waiting-input = your move,
// idle = alive but quiet (greyed).
const STATUS = {
  busy: { cls: 'acc', label: 'working' },
  'waiting-input': { cls: 'warn', label: 'your move' },
  idle: { cls: '', label: 'idle' },
}

// Last path segment of a working dir — the card's heading when a session has no
// title yet; the full path rides below it, muted.
function baseName(p) {
  if (!p) return ''
  const parts = p.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || p
}

function SessionCard({ s }) {
  const st = STATUS[s.status] || STATUS.idle
  return (
    <div className="card pad-md">
      <div className="row between wrap gap-12">
        <div className="row gap-10" style={{ minWidth: 0 }}>
          <Icon name="activity" />
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0 }}>{s.title || baseName(s.cwd) || s.session_id}</h3>
            {s.cwd && (
              <div
                className="dim mono"
                style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={s.cwd}
              >
                {s.cwd}
              </div>
            )}
          </div>
        </div>
        <div className="row gap-10" style={{ flexShrink: 0 }}>
          {s.agent && <span className="badge">{s.agent}</span>}
          <span className={`badge ${st.cls}`}>
            <span className="dot" />
            {st.label}
          </span>
        </div>
      </div>
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

  const sessions = data?.activity || []

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
      </div>
      <ErrorState error={error} style={{ marginBottom: 12 }} />
      {!data ? (
        <Loading label="Reading live sessions…" />
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
