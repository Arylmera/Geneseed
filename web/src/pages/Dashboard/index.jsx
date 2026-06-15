import React, { useEffect, useState } from 'react'
import { api } from '../../api/index.js'
import StatusView from './StatusView.jsx'
import LineageView from './LineageView.jsx'
import OperatorView from './OperatorView.jsx'
import GreenhouseView from './GreenhouseView.jsx'
import OperatorHudView from './OperatorHudView.jsx'
import Onboarding from './Onboarding.jsx'

// The dashboard shell: loads the supplementary data (install snapshot, job
// history, graph, doctor) the directions share, then renders the chosen
// direction. The Status lens swaps per flavour — Cultivar's classic
// hero+kpi+genome, Greenhouse's ring+tiles+donut, or Operator HUD's strip+
// modules — while Lineage and Operator stay one shared layout (they're
// optional data dives, not flavour variants).
export default function Dashboard({ overview, themes, onAction, flavour = 'a' }) {
  const [dir, setDir] = useState('status')
  const [setup, setSetup] = useState(null)
  const [jobs, setJobs] = useState([])
  const [graph, setGraph] = useState(null)
  const [doctor, setDoctor] = useState(null)
  const sigil = overview ? themes.find((t) => t.name === overview.theme)?.sigil || '' : ''

  useEffect(() => {
    let alive = true
    api
      .setup()
      .then((v) => alive && setSetup(v))
      .catch(() => {})
    api
      .jobs()
      .then((r) => alive && setJobs(r.jobs || []))
      .catch(() => {})
    api
      .graph()
      .then((v) => alive && setGraph(v))
      .catch(() => {})
    // Doctor is only needed by Greenhouse (ring + check chips) and Operator
    // HUD (check matrix). Cultivar's Status lens doesn't read it, so the load
    // is lazy: skipping it on Cultivar saves a round-trip on dashboard mount.
    if (flavour === 'b' || flavour === 'c') {
      api
        .doctor()
        .then((v) => alive && setDoctor(v))
        .catch(() => {})
    }
    return () => {
      alive = false
    }
  }, [flavour])

  if (!overview) return <div className="loading">Loading&#8230;</div>

  // Nothing deployed yet → onboard the user into a first deploy instead of
  // showing an empty, read-only dashboard.
  if (!overview.deployed) return <Onboarding onAction={onAction} />

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
        <div className="seg">
          {[
            ['status', 'Status'],
            ['lineage', 'Lineage'],
            ['operator', 'Operator'],
          ].map(([k, l]) => (
            <button key={k} className={dir === k ? 'on' : ''} onClick={() => setDir(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {dir === 'status' && flavour === 'a' && (
        <StatusView
          overview={overview}
          sigil={sigil}
          setup={setup}
          jobs={jobs}
          onAction={onAction}
        />
      )}
      {dir === 'status' && flavour === 'b' && (
        <GreenhouseView
          overview={overview}
          sigil={sigil}
          jobs={jobs}
          doctor={doctor}
          onAction={onAction}
        />
      )}
      {dir === 'status' && flavour === 'c' && (
        <OperatorHudView
          overview={overview}
          jobs={jobs}
          doctor={doctor}
          onAction={onAction}
        />
      )}
      {dir === 'lineage' && (
        <LineageView overview={overview} sigil={sigil} setup={setup} jobs={jobs} graph={graph} />
      )}
      {dir === 'operator' && <OperatorView overview={overview} setup={setup} jobs={jobs} />}
    </>
  )
}
