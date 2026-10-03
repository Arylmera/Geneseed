import React, { useState } from 'react'
import { api } from '../api/index.js'
import { usePoll } from '../hooks/usePoll.js'
import ErrorState from './ErrorState.jsx'
import Loading from './Loading.jsx'
import RingGraph from './RingGraph.jsx'

const enc = encodeURIComponent
const POLL_MS = 5000
const PRESETS = ['prudent', 'balanced', 'aggressive']
// running reads as the accent (live), awaiting as a warning (it needs the user), unreadable
// as an error; done/stopped/finished are plain — over, nothing to act on.
const TONE = { running: 'acc', awaiting: 'warn', unreadable: 'bad' }
// A live row carries LOOP.md's state; a `finished` (LOOP.md gone) or `unreadable` row carries
// only its identity, so it has no graph, iteration or preset to show.
const live = (l) => !!l.graph

function RunCard({ loop, on, onPreset }) {
  const it = live(loop) ? (loop.graph.loops || []).find((x) => x.iteration) : null
  const cls = `panel loop-run${on ? ' on' : ''}${loop.status === 'awaiting' ? ' awaiting' : ''}${live(loop) ? '' : ' dimmed'}`
  return (
    <div className={cls}>
      <div className="loop-brick-head">
        <a
          className="loop-run-title"
          href={`#/loops/active/${enc(loop.root)}`}
          aria-current={on ? 'true' : undefined}
        >
          {loop.title}
        </a>
        <span className={`tag${TONE[loop.status] ? ` ${TONE[loop.status]}` : ''}`}>
          {loop.status}
        </span>
      </div>
      <span className="panel-note mono">{loop.branch}</span>
      {live(loop) ? (
        <>
          <span className="panel-note">
            iteration {loop.iteration}
            {it ? ` / ${it.max}` : ''} · at {loop.node}
          </span>
          {loop.awaiting ? (
            <p className="loop-run-wait t-warn">
              <b>Awaiting {loop.awaiting.kind}</b> — Answer in the agent&apos;s session.
            </p>
          ) : null}
          <label className="panel-note loop-run-preset">
            preset
            <select
              className="sel"
              aria-label={`Preset for ${loop.title}`}
              value={loop.preset}
              onChange={(e) => onPreset(loop.root, e.target.value)}
            >
              {PRESETS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
        </>
      ) : null}
    </div>
  )
}

function History({ history }) {
  if (!history.length) return <p className="panel-note">No iteration finished yet.</p>
  return (
    <div className="loop-history">
      <table className="tbl">
        <thead>
          <tr>
            {['iteration', 'intent', 'declared', 'actual', 'decision', 'tests'].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <tr key={h.iteration}>
              <td className="num">{h.iteration}</td>
              <td>{h.intent}</td>
              <td className="num">{h.declared}</td>
              <td className="num">{h.actual}</td>
              <td>{h.decision}</td>
              <td>{h.tests}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Loops › Active: every loop `geneseed loop init` registered on this machine, polled. LOOP.md
// is the only state, so the page writes exactly one thing — a loop's preset — and leaves every
// decision to the agent's session that is running the loop (see the spec's out-of-scope list).
// `bricks` come from the catalogue the page already read: the ring needs each brick's effect to
// place the ⛨ validate gate.
export default function ActiveLoops({ item, bricks }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [rev, setRev] = useState(0)
  usePoll(
    (alive) =>
      api.activeLoops().then(
        (d) => alive() && (setData(d), setError(null)),
        (e) => alive() && setError(e.message),
      ),
    POLL_MS,
    [rev],
  )
  const onPreset = (root, preset) =>
    api.setLoopPreset(root, preset).then(
      () => setRev((r) => r + 1),
      (e) => setError(e.message),
    )

  if (!data) return error ? <ErrorState error={error} /> : <Loading />
  const { loops } = data
  if (!loops.length) {
    return (
      <div className="empty">
        <div className="big">No loops yet</div>
        Start one with <code className="mono">geneseed loop init</code> in a worktree, or ask the
        agent to run a loop. It shows up here while it runs.
      </div>
    )
  }
  const sel = loops.find((l) => l.root === item && live(l)) || loops.find(live)
  return (
    <>
      <ErrorState error={error} style={{ margin: '0 0 12px' }} />
      <div className="loop-templates">
        {loops.map((l) => (
          <RunCard key={l.root} loop={l} on={l === sel} onPreset={onPreset} />
        ))}
      </div>
      {sel ? (
        <>
          <div className="panel loop-graph">
            <RingGraph graph={sel.graph} bricks={bricks} highlight={sel.node} />
          </div>
          <h2 className="loop-h2">Iterations of {sel.title}</h2>
          <History history={sel.history} />
        </>
      ) : null}
    </>
  )
}
