import React, { useEffect, useState } from 'react'
import { api } from '../../api/index.js'
import StatusView from './StatusView.jsx'
import LineageView from './LineageView.jsx'
import OperatorView from './OperatorView.jsx'

// The dashboard shell: loads the supplementary data (install snapshot, job
// history, graph) the directions share, then renders the chosen direction. The
// three directions live in their own files; this file owns only the switch.
export default function Dashboard({ overview, themes, onAction }) {
  const [dir, setDir] = useState('status')
  const [setup, setSetup] = useState(null)
  const [jobs, setJobs] = useState([])
  const [graph, setGraph] = useState(null)
  const sigil = overview ? (themes.find((t) => t.name === overview.theme)?.sigil || '') : ''

  useEffect(() => {
    let alive = true
    api.setup().then((v) => alive && setSetup(v)).catch(() => {})
    api.jobs().then((r) => alive && setJobs(r.jobs || [])).catch(() => {})
    api.graph().then((v) => alive && setGraph(v)).catch(() => {})
    return () => { alive = false }
  }, [])

  if (!overview) return <div className="loading">Loading&#8230;</div>

  return (
    <>
      <div className="head-row">
        <div>
          <span className="eyebrow">overview</span>
          <h1 className="h">Harness console</h1>
          <p className="sub">A live readout of the harness deployed on this machine — its voice, its capabilities, and its drift from source.</p>
        </div>
        <div className="seg">
          {[['status', 'Status'], ['lineage', 'Lineage'], ['operator', 'Operator']].map(([k, l]) => (
            <button key={k} className={dir === k ? 'on' : ''} onClick={() => setDir(k)}>{l}</button>
          ))}
        </div>
      </div>
      {dir === 'status'   && <StatusView   overview={overview} sigil={sigil} setup={setup} jobs={jobs} onAction={onAction} />}
      {dir === 'lineage'  && <LineageView  overview={overview} sigil={sigil} setup={setup} jobs={jobs} graph={graph} />}
      {dir === 'operator' && <OperatorView overview={overview} setup={setup} jobs={jobs} />}
    </>
  )
}
