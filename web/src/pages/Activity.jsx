import React, { useId, useState } from 'react'
import { api } from '../api/index.js'
import { Icon } from '../components/Icon.jsx'
import { relTime } from '../lib/format.js'
import { baseName, hasCounters, SessionHeader, TodoStrip } from '../lib/activity.jsx'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'
import EmptyState from '../components/EmptyState.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { useFlip } from '../lib/motion.js'
import { usePoll } from '../hooks/usePoll.js'

function SessionCard({ s }) {
  const id = useId()
  const todos = s.todos
  const counters = hasCounters(s)
  // A real <a>, not a div playing one: middle-click, open-in-new-tab and the
  // screen reader's links list all work, and nothing inside it is interactive. Its name
  // is the title and status alone; the counters describe it rather than name it.
  return (
    <a
      className="card pad-md act-card"
      href={`#/activity/${encodeURIComponent(s.session_id)}`}
      aria-labelledby={`${id}-t ${id}-st`}
      aria-describedby={counters ? `${id}-c` : undefined}
    >
      <SessionHeader s={s} id={id} heading={s.title || baseName(s.cwd) || s.session_id}>
        {/* affordance: this card opens the session detail (the card itself is the link) */}
        <Icon name="chevron" className="glyph act-chev" />
      </SessionHeader>

      {todos && todos.total > 0 && (
        <div className="act-foot">
          <span className="row gap-8 dim act-sm">
            <TodoStrip done={todos.done} total={todos.total} />
            plan {todos.done}/{todos.total}
          </span>
        </div>
      )}

      <div className="dim mono act-updated">updated {relTime(s.updated_at)} ago</div>
    </a>
  )
}

export default function Activity() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  // 2s is plenty for a glanceable HUD; a failed poll is held (the next tick
  // recovers) so a momentary blip doesn't blank the view.
  usePoll(
    (alive) =>
      api.activity().then(
        (d) => {
          if (alive()) {
            setData(d)
            setError('')
          }
        },
        (e) => {
          if (alive()) setError(e.message)
        },
      ),
    2000,
    [],
  )

  // Default on when the field is absent (older server / first paint).
  const enabled = data ? data.enabled !== false : true
  // Sorted by id, ascending: the server buckets by status and recency, which reorders the
  // cards on every turn; an id never changes, so a card stays where the eye left it.
  // OpenCode ids descend with time, so ascending puts the newest first; Claude ids are
  // random, but still stable.
  const sessions = [...(data?.activity || [])].sort((a, b) =>
    a.session_id < b.session_id ? -1 : a.session_id > b.session_id ? 1 : 0,
  )
  const flipRef = useFlip()

  const toggle = async () => {
    const next = !enabled
    try {
      const res = await api.activityToggle(next)
      // Optimistic: reflect the flip now; the next poll reconciles from disk.
      setData((d) => ({
        ...(d || {}),
        enabled: res.enabled,
        activity: res.enabled ? d?.activity || [] : [],
      }))
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="narrow">
      <PageHeader
        title="Activity"
        sub="Live OpenCode sessions this harness is running: what each one is doing right now. Refreshes every couple of seconds; sessions drop off when their process exits."
        actions={
          <div className="row gap-10 act-fixed">
            <span className="dim mono act-xs">{enabled ? 'tracking on' : 'tracking off'}</span>
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
        }
      />
      {error && (
        <div className="act-gap">
          <ErrorState error={error} />
        </div>
      )}
      {!data ? (
        <Loading label="Reading live sessions…" />
      ) : !enabled ? (
        <EmptyState title="Activity tracking is off">
          The plugin isn&apos;t recording sessions. Flip the switch to turn it back on.
        </EmptyState>
      ) : sessions.length === 0 ? (
        <EmptyState title="No active sessions">
          Run <code>opencode</code> and the sessions it spins up appear here.
        </EmptyState>
      ) : (
        // A poll that adds or drops a session slides the list instead of re-dealing it.
        <div className="stack gap-12" ref={flipRef}>
          {sessions.map((s) => (
            <div key={s.session_id} data-flip={s.session_id}>
              <SessionCard s={s} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
