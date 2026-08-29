import React from 'react'
import { SECTION_ORDER } from '../../lib/sections.js'
import { maxCount, editCount } from '../../lib/format.js'
import StrandRow from './StrandRow.jsx'
import ActivityFeed from './ActivityFeed.jsx'

// Direction B · Lineage — the source -> render -> deployed timeline and the
// genome-by-volume strand chart.
export default function LineageView({ overview, sigil, setup, jobs }) {
  const max = maxCount(overview.counts)
  const verdict = setup?.version_verdict || ''
  const verdictOk = verdict.includes('up to date')
  const edits = editCount(overview.diff)

  const steps = [
    ['Source', 'src/, the canonical genetic material', setup?.source_fp || '—', true],
    ['Render', `geneseed build → ${overview.emit}`, overview.theme + ' voice', true],
    ['Deployed', overview.target, 'inherited by every repo', false],
  ]

  return (
    <>
      <div className="mb-16">
        <div className="card pad-lg rise" style={{ position: 'relative', overflow: 'hidden' }}>
          <h2 className="h" style={{ fontSize: 22, margin: '0 0 18px' }}>
            Gene-seed lineage
          </h2>
          <div className="lineage-track">
            <div className="spine" />
            {steps.map(([t, d, tag, on], i) => (
              <div key={i} className="lineage-step">
                <span className={`node ${on ? 'on' : ''}`} />
                <div className="lt">{t}</div>
                <div className="ld">{d}</div>
                <div className="ltag">{tag}</div>
              </div>
            ))}
          </div>
          <hr className="hr" />
          {sigil && (
            <div className="voice-readout" key={overview.theme} style={{ marginBottom: 14 }}>
              <span className="vr-cur">&#9621;</span>
              <span className="vr-txt">{sigil}</span>
            </div>
          )}
          <div className="row wrap gap-10">
            <span className={`badge ${verdictOk ? 'ok' : 'warn'}`}>
              <span className="dot" />
              in sync · {verdict}
            </span>
            <span className="badge">
              <span className="dot" />
              {edits} local edits
            </span>
          </div>
        </div>
      </div>

      <div className="grid split-even">
        <div className="card pad-lg">
          <div className="card-head">
            <h3>Genome strand</h3>
            <div className="right">
              <span className="tick">by volume</span>
            </div>
          </div>
          {SECTION_ORDER.map((k) => (
            <StrandRow key={k} k={k} overview={overview} max={max} />
          ))}
        </div>
        <div className="card pad-lg">
          <div className="card-head">
            <h3>Recent activity</h3>
          </div>
          <ActivityFeed jobs={jobs} />
        </div>
      </div>
    </>
  )
}
