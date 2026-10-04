import React, { useState } from 'react'
import { api } from '../api/index.js'
import { usePoll } from '../hooks/usePoll.js'
import RingGraph from './RingGraph.jsx'

const POLL_MS = 5000
const PRESETS = ['prudent', 'balanced', 'aggressive']
// running reads as the accent (live), awaiting as a warning (it needs the user), unreadable
// as an error; done/stopped/finished are plain — over, nothing to act on.
export const TONE = { running: 'acc', awaiting: 'warn', unreadable: 'bad' }
// A live row carries LOOP.md's state; a `finished` (LOOP.md gone) or `unreadable` row carries
// only its identity, so it has no graph, iteration or preset to show.
export const live = (l) => !!l.graph

// Loops › Active's read: every loop `geneseed loop init` registered on this machine, polled.
// LOOP.md is the only state, so the page writes exactly one thing — a loop's preset — and leaves
// every decision to the agent's session running the loop (see the spec's out-of-scope list).
// Polled by the page itself, on every section: the rail counts the active loops.
export function useActiveLoops() {
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
  return { loops: data?.loops ?? null, error, onPreset }
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

// The reader pane for one registered loop: where it stands, what it waits on, its preset (the
// one thing the page writes), its ring with the current node lit, and its iteration history.
// `bricks` come from the catalogue the page already read: the ring needs each brick's effect to
// place the ⛨ validate gate.
export function ActiveDetail({ loop, bricks, onPreset }) {
  const it = live(loop) ? (loop.graph.loops || []).find((x) => x.iteration) : null
  return (
    <>
      <div className="reader-tags">
        <span className="tag acc">Active loop</span>
        <span className={`tag${TONE[loop.status] ? ` ${TONE[loop.status]}` : ''}`}>
          {loop.status}
        </span>
      </div>
      <h2 className="reader-title">{loop.title}</h2>
      <p className="mono dim reader-src">
        {loop.branch} · {loop.root}
      </p>
      {live(loop) ? (
        <>
          <p className="reader-lede">
            Iteration {loop.iteration}
            {it ? ` / ${it.max}` : ''} · at {loop.node}
          </p>
          {loop.awaiting ? (
            <p className="loop-run-wait t-warn">
              <b>
                Awaiting {loop.awaiting.kind}
                {loop.awaiting.kind === 'gate' ? ` at ${loop.awaiting.node}` : ''}
              </b>{' '}
              — Answer in the agent&apos;s session.
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
          <hr className="hr" />
          <div className="loop-graph">
            <RingGraph graph={loop.graph} bricks={bricks} highlight={loop.node} />
          </div>
          <h3 className="loop-h2">Iterations</h3>
          <History history={loop.history} />
        </>
      ) : (
        <p className="reader-lede">
          {loop.status === 'unreadable'
            ? 'Its LOOP.md cannot be read, so there is no state to show.'
            : 'Its LOOP.md is gone: the loop closed and its state went with it.'}
        </p>
      )}
    </>
  )
}
