import React from 'react'
import { go } from '../../lib/router.js'
import { SECTIONS } from '../../lib/sections.js'
import { relTime, ruleCount } from '../../lib/format.js'
import ConstitutionMap from './ConstitutionMap.jsx'
import VerdictBadge from './VerdictBadge.jsx'

// THE FIELD JOURNAL — the fourth Status lens, and the one that answers "what is this
// harness, today" instead of "is it healthy". The health readout is still one click away
// (the rail's vitals card on every page, and Run doctor in the lens row above); what this lens
// leads with is the shape of the thing: how much has grown in each section, what grew most
// recently, and the constitution that governs all of it, drawn rather than tallied.
// One proportional bar per content section. The denominator is the largest count on show,
// so the bars compare the harness against itself — there is no target number of skills.
function GrowthRings({ counts }) {
  const rows = [
    { label: SECTIONS.skills.label, n: counts.skills ?? 0, hash: '#/skills' },
    // The rail's Constitution figure, under the same word as the map's hub below.
    { label: 'Rules', n: ruleCount(counts), hash: '#/laws' },
    { label: SECTIONS.agents.label, n: counts.agents ?? 0, hash: '#/agents' },
    { label: SECTIONS.memory.label, n: counts.memory ?? 0, hash: '#/personal/memory' },
    { label: SECTIONS.notebook.label, n: counts.notebook ?? 0, hash: '#/personal/notebook' },
    { label: SECTIONS.wiki.label, n: counts.wiki ?? 0, hash: '#/section/wiki' },
    { label: SECTIONS.config.label, n: counts.config ?? 0, hash: '#/section/config' },
  ]
  const max = Math.max(...rows.map((r) => r.n), 1)
  return (
    <div className="card pad-lg jr-card">
      <div className="card-head">
        <h3>Growth rings</h3>
        <span className="tick right">by section</span>
      </div>
      {rows.map((r) => (
        <button className="jr-ring" key={r.label} onClick={() => go(r.hash)}>
          <span className="jr-ring-label">{r.label}</span>
          <span className="jr-ring-track">
            {/* A section with nothing in it draws no bar at all — a 1px sliver would read
                as "a little", which is a different fact from "none". */}
            <span className="jr-ring-fill" style={{ width: `${(r.n / max) * 100}%` }} />
          </span>
          <span className="jr-ring-num">{r.n}</span>
        </button>
      ))}
    </div>
  )
}

// The newest file-backed entries, from /api/recent. Everything here is honest or absent:
// the endpoint drops any section too large to date exhaustively rather than reporting the
// newest of a truncated sample, and this card names what it skipped.
function FreshlyGrown({ recent, buildEpoch }) {
  const items = recent?.items || []
  const skipped = recent?.skipped || []
  return (
    <div className="card pad-lg jr-card">
      <div className="card-head">
        <h3>Freshly grown</h3>
        <span className="tick right">newest</span>
      </div>
      {!recent ? (
        <p className="sub">Reading the shelves…</p>
      ) : items.length === 0 ? (
        <p className="sub">Nothing here carries a date yet.</p>
      ) : (
        items.slice(0, 5).map((it) => (
          <button
            className="jr-fresh"
            key={`${it.section}:${it.name}`}
            onClick={() => go(`#/item/${it.type}/${encodeURIComponent(it.name)}`)}
          >
            <span className="jr-fresh-kind">{it.section}</span>
            <span className="jr-fresh-name">{it.title}</span>
            <span className="jr-fresh-when">{relTime(it.mtime)}</span>
          </button>
        ))
      )}
      {skipped.length > 0 && (
        <p className="sub jr-skipped">
          Not dated: {skipped.join(', ')} — too many files to stat on every load.
        </p>
      )}
      <p className="jr-care">
        {buildEpoch ? `Last built ✓ ${relTime(buildEpoch)}` : 'Never built here'} ·{' '}
        <button className="jr-go" onClick={() => go('#/activity')}>
          log →
        </button>
      </p>
    </div>
  )
}

export default function JournalView({ overview, recent, lens, dataRev }) {
  const counts = overview?.counts || {}
  return (
    <>
      <div className="jr-head">
        <VerdictBadge verdict={lens?.verdict} />
      </div>

      <div className="jr-row2">
        <GrowthRings counts={counts} />
        <FreshlyGrown recent={recent} buildEpoch={overview?.build_epoch} />
      </div>

      <div className="card pad-lg jr-map">
        <div className="card-head">
          <h3>The Constitution — and the harness it governs</h3>
          <button className="jr-go right" onClick={() => go('#/laws')}>
            open →
          </button>
        </div>
        <ConstitutionMap overview={overview} dataRev={dataRev} />
      </div>
    </>
  )
}
