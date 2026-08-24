import React from 'react'
import { go } from '../../lib/router.js'
import { SECTIONS } from '../../lib/sections.js'
import { relTime, rulesInForce } from '../../lib/format.js'
import ConstitutionMap from './ConstitutionMap.jsx'

// THE FIELD JOURNAL — the fourth Status lens, and the one that answers "what is this
// harness, today" instead of "is it healthy". The health readout is still one click away
// (the rail's vitals card carries the germination ring on every page, and Doctor is a
// button in this header); what this lens leads with is the shape of the thing: how much
// has grown in each section, what grew most recently, and the constitution that governs
// all of it, drawn rather than tallied.
//
// It brings its own header because it is a page, not a panel — Dashboard's shell hands it
// the whole pane. The other two directions are a quiet line at the bottom rather than a
// segmented control at the top: they are data dives, and the journal's own subject is the
// harness, not the choice of view.

// Today's date in the same ISO-ish shape the harness stamps everything else with. Local
// time, deliberately: this line names the user's day, not UTC's.
function today() {
  const d = new Date()
  const p2 = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

// One proportional bar per content section. The denominator is the largest count on show,
// so the bars compare the harness against itself — there is no target number of skills.
function GrowthRings({ counts }) {
  const rows = [
    { label: SECTIONS.skills.label, n: counts.skills ?? 0, hash: '#/skills' },
    // "Rules in force", NOT "Constitution" — the rail badges the Constitution with
    // `counts.laws`, which is the INVARIANT count and frozen that way by contract. Both
    // numbers are right and they are not the same quantity, so labelling this row with the
    // rail's word would put "Constitution 9" and "Constitution 32" on one screen. The map's
    // hub below says "N rules in force" for the same figure; this matches its words.
    { label: 'Rules in force', n: rulesInForce(counts), hash: '#/laws' },
    { label: SECTIONS.agents.label, n: counts.agents ?? 0, hash: '#/agents' },
    { label: SECTIONS.memory.label, n: counts.memory ?? 0, hash: '#/section/memory' },
    { label: SECTIONS.notebook.label, n: counts.notebook ?? 0, hash: '#/section/notebook' },
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

export default function JournalView({ overview, recent, onAction, onDirection }) {
  const counts = overview?.counts || {}
  return (
    <>
      <div className="head-row jr-head">
        <div>
          <div className="eyebrow">Field journal · {today()}</div>
          <h1 className="h">Today in this harness</h1>
        </div>
        <div className="row wrap gap-10">
          <button className="btn primary" onClick={() => onAction?.('update')}>
            Update &amp; rebuild
          </button>
          <button className="btn" onClick={() => go('#/doctor')}>
            Doctor
          </button>
        </div>
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
        <ConstitutionMap overview={overview} />
      </div>

      {/* The other two directions, kept reachable. They were a segmented control beside a
          "Harness console" title this lens replaces; demoting them to a line is what buys
          the journal its own header. */}
      <p className="sub jr-others">
        Other views:{' '}
        <button className="jr-go" onClick={() => onDirection?.('lineage')}>
          Lineage
        </button>{' '}
        ·{' '}
        <button className="jr-go" onClick={() => onDirection?.('operator')}>
          Operator
        </button>
      </p>
    </>
  )
}
