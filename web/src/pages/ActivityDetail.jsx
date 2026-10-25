import React, { useCallback, useId, useMemo, useState } from 'react'
import { api } from '../api/index.js'
import { Icon } from '../components/Icon.jsx'
import { relTime } from '../lib/format.js'
import { baseName, compact, needsYou, SessionHeader } from '../lib/activity.jsx'
import { contextFill, gardenTree, treeKey } from '../lib/garden.js'
import { PadCard, readSakura, TreeSvg } from './Activity/Bonsai.jsx'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'
import EmptyState from '../components/EmptyState.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { usePoll } from '../hooks/usePoll.js'

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
    <div className="row gap-10 act-line">
      <span className={`badge act-who ${you ? '' : 'acc'}`}>{you ? 'you' : 'agent'}</span>
      <div className="act-grow act-sm">
        {!you && <span className={`feed-dot act-inline-dot ${dotFor(rec) || 'acc'}`} />}
        {rec.kind === 'thinking' && <span className="dim">thinking: </span>}
        {soft ? <span className="dim">{label}</span> : you ? label : <b>{label}</b>}
        {rec.error && <span className="dim">: {rec.error}</span>}
      </div>
      {meta.length > 0 && <span className="dim mono act-xs act-fixed">{meta.join(' · ')}</span>}
      {rec.t ? (
        <time
          className="mono dim act-xs act-fixed"
          dateTime={new Date(rec.t).toISOString()}
          title={`${relTime(rec.t / 1000)} ago`}
        >
          {new Date(rec.t).toTimeString().slice(0, 8)}
        </time>
      ) : null}
    </div>
  )
}

// The compact default for the timeline: the full conversation as an ordered
// transcript of bounded turns (you / agent), oldest → newest.
function Conversation({ turns }) {
  if (!turns || turns.length === 0) {
    return <div className="dim act-sm">No conversation captured yet.</div>
  }
  return (
    <div className="stack gap-12">
      {turns.map((m, i) => {
        const you = m.role === 'user'
        return (
          <div key={i} className="row gap-10 act-line">
            <span className={`badge act-who ${you ? '' : 'acc'}`}>{you ? 'you' : 'agent'}</span>
            <div className={`act-min act-sm${you ? '' : ' muted'}`}>{m.text}</div>
          </div>
        )
      })}
    </div>
  )
}

// The session's bonsai, read-only: the garden's drawing a size up, its pads hoverable for the
// same file card. An ended session's tree stands as it was, without motion or the needs-you
// call: nobody can answer an ended session.
const TREE_PX = 5
export function SessionTree({ s }) {
  const [sakura] = useState(readSakura)
  const [pad, setPad] = useState(null)
  const ended = !!s.ended
  // The header above still says what the error was; the tree just carries no bubble.
  const drawn = ended ? { ...s, status: needsYou(s) ? 'busy' : s.status, error: null } : s
  const key = treeKey(drawn, sakura)
  // Keyed on what the drawing reads, so the 2 s poll leaves an unchanged tree alone.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const t = useMemo(() => gardenTree(drawn, { sakura }), [key])
  const onPad = useCallback((p) => setPad(p), [])
  const fill = contextFill(s)
  const turns = Number(s.turns) || 0
  const compactions = Number(s.compactions) || 0
  const legend = [
    `${turns} turn${turns === 1 ? '' : 's'}`,
    `context ${fill == null ? 'unknown' : `${Math.round(fill * 100)} %`}`,
    `${compactions} compaction${compactions === 1 ? '' : 's'}`,
    `sub-agents: ${t.pads.filter((p) => p.key != null).length} ${ended ? 'unfinished' : 'running'}, ${t.fallen.length} finished`,
  ].join(' · ')
  const hot = pad != null ? t.pads[pad] : null
  return (
    <div className={`card pad-md act-mt gd-detail${!ended && needsYou(s) ? ' gd-needs' : ''}`}>
      <TreeSvg
        t={t}
        pad={pad}
        swaying={!ended && s.status !== 'idle'}
        onPad={onPad}
        px={TREE_PX}
        label={`Bonsai of this session${ended ? ', ended' : ''}: ${legend}`}
      />
      <div className="stack gap-8 act-min">
        {ended && <span className="dim act-xs">ended</span>}
        <div className="dim act-sm">{legend}</div>
        {hot ? (
          <PadCard pad={hot} />
        ) : (
          <div className="dim act-xs">Hover a pad for the files it changed.</div>
        )}
      </div>
    </div>
  )
}

export default function ActivityDetail({ sid }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [gone, setGone] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const streamId = useId()

  // Poll the per-session endpoint on the same 2s HUD cadence; a 404 means the
  // session ended (pruned), which is a normal terminal state, not an error. An ended
  // session never comes back under the same id (App remounts on a new one), so `gone`
  // stops the poll instead of asking for the same 404 every two seconds.
  usePoll(
    (alive) =>
      gone
        ? undefined
        : api.activityDetail(sid).then(
            (d) => {
              if (alive()) {
                setData(d)
                setError('')
                setGone(false)
              }
            },
            (e) => {
              if (!alive()) return
              if (e.status === 404) setGone(true)
              else setError(e.message)
            },
          ),
    2000,
    [sid, gone],
  )

  const back = (
    <a className="btn ghost sm act-back" href="#/activity">
      <Icon name="arrow" /> Activity
    </a>
  )

  if (gone) {
    return (
      <div className="page-fill">
        {back}
        <EmptyState title="Session ended" action={<a href="#/activity">Back to Activity</a>}>
          It&apos;s no longer live.
        </EmptyState>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="page-fill">
        {back}
        {/* A first fetch that failed (daemon down, 500) says so instead of loading forever. */}
        {error ? <ErrorState error={error} /> : <Loading label="Loading session…" />}
      </div>
    )
  }

  const s = data.session
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
    <div className="page-fill">
      {back}
      <PageHeader
        title={s.title || baseName(s.cwd) || s.session_id}
        sub={
          s.cwd ? (
            <span className="mono act-cwd" title={s.cwd}>
              {s.cwd}
            </span>
          ) : null
        }
      />
      {error && (
        <div className="act-gap">
          <ErrorState error={error} />
        </div>
      )}

      <div className="card pad-md">
        <SessionHeader s={s} />
        <div className="dim act-updated">updated {relTime(s.updated_at)} ago</div>
      </div>

      <SessionTree s={s} />

      {(filesShown || todosShown) && (
        // Both present → even halves; only one → it takes the full width.
        <div className={`grid gap-12 act-panels${filesShown && todosShown ? ' two' : ''}`}>
          {filesShown && (
            <div className="card pad-md">
              <div className="card-head">
                <h2>
                  Files touched <span className="dim">({files.count})</span>
                </h2>
              </div>
              <div className="stack act-list">
                {files.items.map((f) => (
                  <div key={f.file} className="row between gap-12 act-sm">
                    <span className="mono act-ell act-grow" title={f.file}>
                      {f.file}
                    </span>
                    <span className="act-fixed">
                      <span className="t-good">+{f.additions}</span>{' '}
                      <span className="t-bad">−{f.deletions}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {todosShown && (
            <div className="card pad-md">
              <div className="card-head">
                <h2>
                  Plan{' '}
                  <span className="dim">
                    ({todos.done}/{todos.total})
                  </span>
                </h2>
              </div>
              <div className="stack act-list">
                {todos.items.map((t, i) => (
                  <div key={i} className="row gap-8 act-sm">
                    <span
                      className={`feed-dot ${t.status === 'completed' ? 'ok' : t.status === 'in_progress' ? 'acc' : ''}`}
                    />
                    <span className={t.status === 'completed' ? 'act-done' : undefined}>
                      {t.content}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card pad-md act-mt">
        <div className="card-head act-tl-head">
          <h2>Timeline</h2>
          {steps.length > 0 && (
            <button
              className="btn ghost sm"
              aria-expanded={expanded}
              aria-controls={streamId}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? 'Show conversation' : `Show full stream (${stream.length})`}
            </button>
          )}
        </div>
        <div id={streamId}>
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
    </div>
  )
}
