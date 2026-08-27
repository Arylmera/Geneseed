import React, { useEffect, useRef, useState } from 'react'
import { api } from '../../api/index.js'
import StatusView from './StatusView.jsx'
import LineageView from './LineageView.jsx'
import OperatorView from './OperatorView.jsx'
import GreenhouseView from './GreenhouseView.jsx'
import OperatorHudView from './OperatorHudView.jsx'
import JournalView from './JournalView.jsx'
import Onboarding from './Onboarding.jsx'
import { resolveLayout } from '../../hooks/useLayout.js'

// The dashboard shell: loads the supplementary data (graph, doctor, recency) the
// directions share, then renders the chosen direction. The Status lens is a layout
// chosen independently of the flavour (skin) — Cultivar's hero+kpi+genome,
// Greenhouse's ring+tiles+donut, Operator HUD's strip+modules, or the Journal's
// rings+map — while Lineage and Operator stay one shared layout (they're optional
// data dives, not layout variants).
//
// `setup` and `runs` (job history) arrive as props rather than being fetched here:
// the rail and the console own those same copies, and App owns the one fetch of
// each — so they stay live while a job streams instead of showing a stale snapshot.
export default function Dashboard({
  overview,
  themes,
  setup,
  runs: jobs,
  onAction,
  flavour = 'a',
  layout = 'auto',
  dataRev,
}) {
  const lens = resolveLayout(flavour, layout)
  const [dir, setDir] = useState('status')
  const [graph, setGraph] = useState(null)
  const [doctor, setDoctor] = useState(null)
  const [recent, setRecent] = useState(null)
  const sigil = overview ? themes.find((t) => t.name === overview.theme)?.sigil || '' : ''

  useEffect(() => {
    let alive = true
    // Doctor is only needed by Greenhouse (ring + check chips) and Operator
    // HUD (check matrix). Cultivar's Status lens doesn't read it, so the load
    // is lazy: skipping it on Cultivar saves a round-trip on dashboard mount.
    if (lens === 'greenhouse' || lens === 'operator') {
      api
        .doctor()
        .then((v) => alive && setDoctor(v))
        .catch(() => {})
    }
    // Recency stats every file-backed entry in the harness server-side, so it is
    // fetched by the one lens that shows it and by nothing else.
    if (lens === 'journal') {
      api
        .recent()
        .then((v) => alive && setRecent(v))
        .catch(() => {})
    }
    return () => {
      alive = false
    }
  }, [lens, dataRev])

  // The graph is the heaviest supplementary fetch and only LineageView reads it, which
  // only renders after the user clicks the Lineage segment — so fetch lazily, on first
  // visit to that dir. graphRevRef caches it per dataRev: switching dir away and back
  // doesn't refetch, but a job finishing (dataRev bumps) invalidates the cache for the
  // next time Lineage is open or opened.
  const graphRevRef = useRef(null)
  useEffect(() => {
    if (dir !== 'lineage' || graphRevRef.current === dataRev) return
    let alive = true
    api
      .graph()
      .then((v) => {
        if (!alive) return
        setGraph(v)
        graphRevRef.current = dataRev
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [dir, dataRev])

  if (!overview) return <div className="loading">Loading&#8230;</div>

  // Nothing deployed yet → onboard the user into a first deploy instead of
  // showing an empty, read-only dashboard.
  if (!overview.deployed) return <Onboarding onAction={onAction} />

  // The Journal lens is a page, not a panel: it brings its own header (the field
  // journal's date line and its two actions), so the shared head-row and the
  // direction switcher would be a second, contradictory title above it. Lineage
  // and Operator stay reachable from the rail's Activity/Changes rows and from
  // Settings' layout picker — the switcher returns with any other lens.
  if (dir === 'status' && lens === 'journal')
    return (
      <JournalView overview={overview} recent={recent} onAction={onAction} onDirection={setDir} />
    )

  return (
    <>
      <div className="head-row">
        <div>
          <h1 className="h">Harness console</h1>
          <p className="sub">
            A live readout of the harness this machine carries. Its voice, its capabilities, its
            drift from source.
          </p>
        </div>
        <div className="seg" role="group" aria-label="Dashboard view">
          {[
            ['status', 'Status'],
            ['lineage', 'Lineage'],
            ['operator', 'Operator'],
          ].map(([k, l]) => (
            <button
              key={k}
              className={dir === k ? 'on' : ''}
              onClick={() => setDir(k)}
              aria-pressed={dir === k}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      {dir === 'status' && lens === 'cultivar' && (
        <StatusView
          overview={overview}
          sigil={sigil}
          setup={setup}
          jobs={jobs}
          onAction={onAction}
        />
      )}
      {dir === 'status' && lens === 'greenhouse' && (
        <GreenhouseView
          overview={overview}
          sigil={sigil}
          jobs={jobs}
          doctor={doctor}
          onAction={onAction}
        />
      )}
      {dir === 'status' && lens === 'operator' && (
        <OperatorHudView overview={overview} jobs={jobs} doctor={doctor} onAction={onAction} />
      )}
      {dir === 'lineage' && (
        <LineageView overview={overview} sigil={sigil} setup={setup} jobs={jobs} graph={graph} />
      )}
      {dir === 'operator' && <OperatorView overview={overview} setup={setup} jobs={jobs} />}
    </>
  )
}
