import React from 'react'
import { go } from '../../lib/router.js'
import { Icon } from '../../components/Icon.jsx'
import { SECTION_ORDER } from '../../lib/sections.js'
import { maxCount, editCount } from '../../lib/format.js'
import StrandRow from './StrandRow.jsx'
import MiniGraph from './MiniGraph.jsx'
import ActivityFeed from './ActivityFeed.jsx'

// Direction B · Lineage — the source -> render -> deployed timeline, a graph
// preview, and the genome-by-volume strand chart.
export default function LineageView({ overview, sigil, setup, jobs, graph }) {
  const max = maxCount(overview.counts)
  const verdict = setup?.version_verdict || ''
  const verdictOk = verdict.includes('up to date')
  const edits = editCount(overview.diff)

  const steps = [
    ['Source', 'src/ — the canonical genetic material', setup?.source_fp || '—', true],
    ['Render', `build.py → ${overview.emit}`, overview.theme + ' voice', true],
    ['Deployed', overview.target, 'inherited by every repo', false],
  ]

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1.1fr', alignItems: 'stretch', marginBottom: 16 }}>
        <div className="card pad-lg rise" style={{ position: 'relative', overflow: 'hidden' }}>
          <span className="eyebrow">heritage</span>
          <h2 className="h" style={{ fontSize: 22, margin: '12px 0 18px' }}>Gene-seed lineage</h2>
          <div style={{ position: 'relative', paddingLeft: 26 }}>
            <div style={{ position: 'absolute', left: 7, top: 6, bottom: 18, width: 2,
              background: 'linear-gradient(var(--accent), var(--line-2))' }} />
            {steps.map(([t, d, tag, on], i) => (
              <div key={i} style={{ position: 'relative', marginBottom: i < 2 ? 22 : 0 }}>
                <span style={{ position: 'absolute', left: -26, top: 3, width: 14, height: 14,
                  borderRadius: '50%', background: on ? 'var(--accent)' : 'var(--surface-3)',
                  border: '2px solid var(--bg)', boxShadow: on ? '0 0 10px var(--accent)' : 'none' }} />
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15 }}>{t}</div>
                <div className="muted" style={{ fontSize: 13 }}>{d}</div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{tag}</div>
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
          <div className="row wrap" style={{ gap: 10 }}>
            <span className={`badge ${verdictOk ? 'ok' : 'warn'}`}><span className="dot" />in sync · {verdict}</span>
            <span className="badge"><span className="dot" />{edits} local edits</span>
          </div>
        </div>
        <div className="card pad-lg rise" style={{ animationDelay: '80ms' }}>
          <div className="card-head"><h3>Cross-link constellation</h3>
            <div className="right">
              <button className="btn soft sm" onClick={() => go('#/graph')}>Open graph<Icon name="arrow" /></button>
            </div>
          </div>
          <MiniGraph graph={graph} />
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        <div className="card pad-lg">
          <div className="card-head"><h3>Genome strand</h3><div className="right"><span className="tick">by volume</span></div></div>
          {SECTION_ORDER.map((k) => <StrandRow key={k} k={k} overview={overview} max={max} />)}
        </div>
        <div className="card pad-lg">
          <div className="card-head"><h3>Recent activity</h3></div>
          <ActivityFeed jobs={jobs} />
        </div>
      </div>
    </>
  )
}
