import React, { useEffect, useState } from 'react'
import { api } from '../api/index.js'
import { Icon } from '../components/Icon.jsx'
import { relTime } from '../lib/format.js'
import { STATUS, ELLIPSIS, baseName, compact, Elapsed } from '../lib/activity.jsx'
import Loading from '../components/Loading.jsx'

// Timeline-row dot colour by record kind/outcome.
function dotFor(rec) {
  if (rec.kind === 'tool')
    return rec.status === 'error' ? 'bad' : rec.status === 'completed' ? 'ok' : 'acc'
  return { retry: 'warn', error: 'bad', subtask: 'acc', text: 'acc' }[rec.kind] || ''
}

// One row of the expanded stream: a you/agent badge, then either the user's prompt
// (you) or the agent step — status dot, label, and any meta (duration / tokens / cost).
function StreamRow({ rec }) {
  const you = rec.who === 'you'
  const meta = []
  if (!you) {
    if (rec.kind === 'tool' && rec.ms != null) meta.push(`${(rec.ms / 1000).toFixed(1)}s`)
    if (rec.kind === 'step') {
      if (rec.tokens) meta.push(`${compact(rec.tokens)} tok`)
      if (rec.cost) meta.push(`$${rec.cost.toFixed(2)}`)
    }
    if (rec.kind === 'subtask' && rec.agent) meta.unshift(rec.agent)
  }
  const soft = !you && (rec.kind === 'text' || rec.kind === 'thinking' || rec.kind === 'step')
  const label = you ? rec.text : rec.label || rec.snippet || rec.kind
  return (
    <div className="row gap-10" style={{ alignItems: 'baseline' }}>
      <span
        className={`badge ${you ? '' : 'acc'}`}
        style={{ flexShrink: 0, minWidth: 52, justifyContent: 'center' }}
      >
        {you ? 'you' : 'agent'}
      </span>
      <div style={{ minWidth: 0, flex: 1, fontSize: 13 }}>
        {!you && (
          <span
            className={`feed-dot ${dotFor(rec) || 'acc'}`}
            style={{ display: 'inline-block', marginRight: 8, verticalAlign: 'middle' }}
          />
        )}
        {rec.kind === 'thinking' && <span className="dim">thinking: </span>}
        {soft ? <span className="dim">{label}</span> : you ? label : <b>{label}</b>}
        {rec.error && <span className="dim"> — {rec.error}</span>}
      </div>
      {meta.length > 0 && (
        <span className="dim mono" style={{ flexShrink: 0, fontSize: 12 }}>
          {meta.join(' · ')}
        </span>
      )}
    </div>
  )
}

// The compact default for the timeline: the full conversation as an ordered
// transcript of bounded turns (you / agent), oldest → newest.
function Conversation({ turns }) {
  if (!turns || turns.length === 0) {
    return (
      <div className="dim" style={{ fontSize: 13 }}>
        No conversation captured yet.
      </div>
    )
  }
  return (
    <div className="stack gap-12">
      {turns.map((m, i) => {
        const you = m.role === 'user'
        return (
          <div key={i} className="row gap-10" style={{ alignItems: 'baseline' }}>
            <span
              className={`badge ${you ? '' : 'acc'}`}
              style={{ flexShrink: 0, minWidth: 52, justifyContent: 'center' }}
            >
              {you ? 'you' : 'agent'}
            </span>
            <div style={{ minWidth: 0, fontSize: 13, color: you ? 'inherit' : 'var(--text-2)' }}>
              {m.text}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function ActivityDetail({ sid }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [gone, setGone] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // Poll the per-session endpoint on the same 2s HUD cadence; a 404 means the
  // session ended (pruned), which is a normal terminal state, not an error.
  useEffect(() => {
    let alive = true
    const tick = () =>
      api.activityDetail(sid).then(
        (d) => {
          if (alive) {
            setData(d)
            setError('')
            setGone(false)
          }
        },
        (e) => {
          if (!alive) return
          if (e.status === 404) setGone(true)
          else setError(e.message)
        },
      )
    tick()
    const t = setInterval(tick, 2000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [sid])

  const back = (
    <a
      className="btn ghost sm"
      href="#/activity"
      style={{ marginBottom: 12, display: 'inline-flex', gap: 6 }}
    >
      <Icon name="arrow" style={{ transform: 'rotate(180deg)' }} /> Activity
    </a>
  )

  if (gone) {
    return (
      <div className="narrow">
        {back}
        <div className="empty">
          <div className="big">Session ended</div>
          It&apos;s no longer live. <a href="#/activity">Back to Activity</a>.
        </div>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="narrow">
        {back}
        <Loading label="Loading session…" />
      </div>
    )
  }

  const s = data.session
  const st = STATUS[s.status] || STATUS.idle
  const files = s.files
  const todos = s.todos
  const filesShown = !!(files && files.items && files.items.length > 0)
  const todosShown = !!(todos && todos.items && todos.items.length > 0)
  const conversation = data.conversation || []
  const steps = data.timeline || []
  // The expanded stream interleaves the user's prompts (you) with the agent's steps
  // (agent), chronological so it reads like a transcript. Assistant text already rides
  // the timeline as `text` steps, so only the user turns are pulled from the convo.
  const stream = [
    ...conversation
      .filter((m) => m.role === 'user')
      .map((m) => ({ who: 'you', text: m.text, t: m.t || 0 })),
    ...steps.map((r) => ({ ...r, who: 'agent' })),
  ].sort((a, b) => (a.t || 0) - (b.t || 0))

  return (
    <div className="narrow">
      {back}
      {error && (
        <p className="badge bad" style={{ marginBottom: 12 }}>
          {error}
        </p>
      )}

      <div className="card pad-md" style={{ borderLeft: `3px solid ${st.accent}` }}>
        <div className="row between wrap gap-12">
          <div style={{ minWidth: 0 }}>
            <h1 className="h" style={{ margin: 0 }}>
              {s.title || baseName(s.cwd) || s.session_id}
            </h1>
            {s.cwd && (
              <div className="dim mono" style={{ fontSize: 12, ...ELLIPSIS }} title={s.cwd}>
                {s.cwd}
              </div>
            )}
          </div>
          <div className="row gap-8" style={{ flexShrink: 0 }}>
            {s.model && <span className="badge mono">{s.model}</span>}
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
        <div
          className="row wrap"
          style={{ gap: 16, marginTop: 12, fontSize: 13, color: 'var(--text-2)' }}
        >
          {s.tokens > 0 && <span>{compact(s.tokens)} tok</span>}
          {s.cost > 0 && <span>${s.cost.toFixed(2)}</span>}
          {s.turn_started_at ? (
            <span>
              <Elapsed startedAt={s.turn_started_at} />
            </span>
          ) : null}
          <span className="dim">updated {relTime(s.updated_at)} ago</span>
        </div>
        {(s.error || s.blocked_on) && (
          <div style={{ marginTop: 10 }}>
            <span className="badge bad" style={{ maxWidth: '100%', ...ELLIPSIS }}>
              {s.error || s.blocked_on}
            </span>
          </div>
        )}
      </div>

      {(filesShown || todosShown) && (
        <div
          className="grid gap-12"
          style={{
            marginTop: 12,
            // Both present → even halves; only one → it takes the full width.
            gridTemplateColumns: filesShown && todosShown ? 'minmax(0, 1fr) minmax(0, 1fr)' : '1fr',
          }}
        >
          {filesShown && (
            <div className="card pad-md">
              <div className="card-head">
                <h3>
                  Files touched <span className="dim">({files.count})</span>
                </h3>
              </div>
              <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                {files.items.map((f) => (
                  <div key={f.file} className="row between gap-12" style={{ fontSize: 13 }}>
                    <span
                      className="mono"
                      style={{ ...ELLIPSIS, minWidth: 0, flex: 1 }}
                      title={f.file}
                    >
                      {f.file}
                    </span>
                    <span style={{ flexShrink: 0 }}>
                      <span style={{ color: 'var(--good)' }}>+{f.additions}</span>{' '}
                      <span style={{ color: 'var(--bad)' }}>−{f.deletions}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {todosShown && (
            <div className="card pad-md">
              <div className="card-head">
                <h3>
                  Plan{' '}
                  <span className="dim">
                    ({todos.done}/{todos.total})
                  </span>
                </h3>
              </div>
              <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                {todos.items.map((t, i) => (
                  <div key={i} className="row gap-8" style={{ fontSize: 13 }}>
                    <span
                      className={`feed-dot ${t.status === 'completed' ? 'ok' : t.status === 'in_progress' ? 'acc' : ''}`}
                    />
                    <span
                      style={{
                        textDecoration: t.status === 'completed' ? 'line-through' : 'none',
                        color: t.status === 'completed' ? 'var(--text-3)' : 'inherit',
                      }}
                    >
                      {t.content}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card pad-md" style={{ marginTop: 12 }}>
        <div className="card-head" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h3>Timeline</h3>
          {steps.length > 0 && (
            <button className="btn ghost sm" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Show conversation' : `Show all ${steps.length} steps`}
            </button>
          )}
        </div>
        {expanded ? (
          <div className="stack gap-12">
            {stream.map((rec, i) => (
              <StreamRow key={i} rec={rec} />
            ))}
          </div>
        ) : (
          <Conversation turns={conversation} />
        )}
      </div>
    </div>
  )
}
