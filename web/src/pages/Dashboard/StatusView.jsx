import React from 'react'
import { SECTION_ORDER } from '../../lib/sections.js'
import { readiness } from '../../lib/format.js'
import { headlineFor } from '../../lib/headlines.js'
import Ring from '../../components/Ring.jsx'
import { useCountUp } from '../../lib/motion.js'
import KpiStrip from './KpiStrip.jsx'
import Genome from './Genome.jsx'
import ActivityFeed from './ActivityFeed.jsx'
import VerdictBadge from './VerdictBadge.jsx'

// The germination dial: the shared ring at the readiness share. ONE tween drives the arc and
// the number, so the two can never disagree mid-flight; the ring's own sweep is off
// (`sweepMs={0}`) for that reason. Whole percents, so the label never reads a float.
// (Its old bezel ticks are gone: the shared ring has none.)
function Germination({ value }) {
  const shown = useCountUp(value, 1100) ?? 0
  const pct = Math.round(shown * 100)
  return (
    <div className="ring-box">
      <Ring value={pct} max={100} label="germination" size={232} stroke={10} sweepMs={0} />
      <div className="ring-center">
        <div className="pct">
          {pct}
          <span className="pct-unit">%</span>
        </div>
        <div className="lbl">germination</div>
      </div>
    </div>
  )
}

// Direction A · Status — the hero readiness ring, KPIs, genome, and activity.
export default function StatusView({ overview, sigil, setup, jobs, lens, dataRev }) {
  const headline = headlineFor(overview, lens?.tone)
  const rv = readiness(overview, setup, lens?.tone)

  return (
    <>
      <div className="card pad-lg rise mb-16">
        <div className="hero">
          <Germination value={rv} />
          <div className="hero-facts">
            <div className="ttl">{headline}</div>
            <VerdictBadge verdict={lens?.verdict} />
            {sigil && (
              <div className="voice-readout" key={overview.theme}>
                <span className="vr-cur">&#9621;</span>
                <span className="vr-txt">{sigil}</span>
              </div>
            )}
            <p className="sub">
              One source rendered into <code>{overview.target}</code>. Every repo on this machine
              inherits it.
            </p>
            <div className="hero-chips">
              <span className="chip">
                <span className="ck">voice</span>
                <span className="cv t-cap">{overview.theme}</span>
              </span>
              <span className="chip">
                <span className="ck">mode</span>
                <span className="cv">{overview.emit}</span>
              </span>
              <span className="chip">
                <span className="ck">footprint</span>
                <span className="cv">{overview.footprint}</span>
              </span>
              <span className="chip">
                <span className="ck">built</span>
                <span className="cv">{overview.build_time || 'unknown'}</span>
              </span>
              <span className="chip">
                <span className="ck">fp</span>
                <span className="cv">{setup?.installed_fp || '—'}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <KpiStrip overview={overview} dataRev={dataRev} />

      <div className="grid split-status">
        <div className="card pad-lg">
          <div className="card-head">
            <h3>Capability genome</h3>
            <div className="right">
              <span className="tick">{SECTION_ORDER.length} sections</span>
            </div>
          </div>
          <Genome overview={overview} />
        </div>
        <div className="card pad-lg">
          <div className="card-head">
            <h3>Recent activity</h3>
            <div className="right">
              <span className="badge acc">
                <span className="dot" />
                live
              </span>
            </div>
          </div>
          <ActivityFeed jobs={jobs} />
        </div>
      </div>
    </>
  )
}
