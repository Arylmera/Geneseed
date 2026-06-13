import React from 'react'
import { Icon } from '../../components/Icon.jsx'
import { SECTION_ORDER } from '../../lib/sections.js'
import { readiness } from '../../lib/format.js'
import Ring from './Ring.jsx'
import KpiStrip from './KpiStrip.jsx'
import Genome from './Genome.jsx'
import ActivityFeed from './ActivityFeed.jsx'

// Voice-flavoured hero headline per theme — UI copy, not server data.
const HEADLINES = {
  neutral: 'Loaded & ready', imperial: 'The Codex in force', military: 'The unit stands ready',
  cyberpunk: 'Jacked in', wizard: 'Wards in place', pirate: 'The crew stands ready',
  gamer: 'Game loaded', sports: 'The squad takes the field', biker: 'The crew rolls out',
  commentator: 'Lights out, away we go', verstappen: "Setup's in", joker: 'Mic check',
  mean: 'Rules are up', marvin: 'Online. Reluctantly.',
}

// Direction A · Status — the hero readiness ring, KPIs, genome, and activity.
export default function StatusView({ overview, sigil, setup, jobs, onAction }) {
  const headline = overview.deployed
    ? (HEADLINES[overview.theme] || 'Loaded & ready')
    : 'Not deployed'
  const rv = readiness(overview, setup)

  return (
    <>
      <div className="card pad-lg rise" style={{ marginBottom: 16 }}>
        <div className="hero">
          <Ring value={rv} />
          <div className="hero-facts">
            <span className="eyebrow">harness · {overview.deployed ? 'deployed' : 'not deployed'}</span>
            <div className="ttl">{headline}</div>
            {sigil && (
              <div className="voice-readout" key={overview.theme}>
                <span className="vr-cur">&#9621;</span>
                <span className="vr-txt">{sigil}</span>
              </div>
            )}
            <p className="sub">
              One source rendered into <code>{overview.target}</code>. Every repo on this machine inherits it.
            </p>
            <div className="hero-chips">
              <span className="chip"><span className="ck">voice</span><span className="cv" style={{ textTransform: 'capitalize' }}>{overview.theme}</span></span>
              <span className="chip"><span className="ck">mode</span><span className="cv">{overview.emit}</span></span>
              <span className="chip"><span className="ck">built</span><span className="cv">{overview.build_time || 'unknown'}</span></span>
              <span className="chip"><span className="ck">fp</span><span className="cv">{setup?.installed_fp || '—'}</span></span>
            </div>
            <div className="row wrap" style={{ gap: 10 }}>
              <button className="btn" onClick={() => onAction('update')}><Icon name="refresh" />Update</button>
              <button className="btn ghost" onClick={() => onAction('build', { theme: overview.theme, emit: overview.emit })}><Icon name="build" />Rebuild</button>
              <button className="btn ghost" onClick={() => onAction('doctor')}><Icon name="doctor" />Run doctor</button>
            </div>
          </div>
        </div>
      </div>

      <KpiStrip overview={overview} />

      <div className="grid" style={{ gridTemplateColumns: '1.55fr 1fr', alignItems: 'start' }}>
        <div className="card pad-lg">
          <div className="card-head"><h3>Capability genome</h3>
            <div className="right"><span className="tick">{SECTION_ORDER.length} sections</span></div></div>
          <Genome overview={overview} />
        </div>
        <div className="card pad-lg">
          <div className="card-head"><h3>Recent activity</h3>
            <div className="right"><span className="badge acc"><span className="dot" />live</span></div></div>
          <ActivityFeed jobs={jobs} />
        </div>
      </div>
    </>
  )
}
