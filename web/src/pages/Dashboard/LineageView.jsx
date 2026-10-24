import React from 'react'
import { SECTION_ORDER } from '../../lib/sections.js'
import { maxCount, editCount } from '../../lib/format.js'
import StrandRow from './StrandRow.jsx'
import ActivityFeed from './ActivityFeed.jsx'
import VerdictBadge from './VerdictBadge.jsx'

// The setup verdict as a short badge label + tone. The server's sentence is the badge's
// tooltip: it is long, and the "differs" one carries a backticked CLI hint that does not
// belong in a badge. The badge used to print "in sync · <sentence>" whatever it said.
function syncBadge(verdict) {
  if (!verdict) return null
  if (verdict.includes('up to date')) return { label: 'in sync', tone: 'ok' }
  if (verdict.includes('no Geneseed install')) return { label: 'not installed', tone: '' }
  return { label: 'behind source', tone: 'warn' }
}

// Direction B · Lineage — the source -> render -> deployed timeline and the
// genome-by-volume strand chart.
export default function LineageView({ overview, sigil, setup, jobs, lens }) {
  const max = maxCount(overview.counts)
  const verdict = setup?.version_verdict || ''
  const sync = syncBadge(verdict)
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
            <VerdictBadge verdict={lens?.verdict} />
            {sync && (
              <span className={`badge ${sync.tone}`} title={verdict}>
                <span className="dot" />
                {sync.label}
              </span>
            )}
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
