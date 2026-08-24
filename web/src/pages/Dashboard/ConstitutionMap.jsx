import React, { useEffect, useState } from 'react'
import { api } from '../../api/index.js'
import { go } from '../../lib/router.js'
import { lawCatColor } from '../../lib/lawCats.js'
import { rulesInForce } from '../../lib/format.js'

// THE CONSTITUTION, DRAWN AS WHAT IT IS: a hub of rules in force, its three tiers around
// it, and dashed lines out to the four things those rules govern. The dashboard used to
// state the same facts as four numbers in four tiles, which is accurate and says nothing
// about how they relate — that the invariants are never negotiable while the doctrines are
// a build-time choice, or that either one reaches the skills and agents at all.
//
// NOTHING IS REUSED FROM MiniGraph, and that is not an oversight. MiniGraph force-relaxes an
// arbitrary cross-link graph into a constellation; this is a FIXED composition — hub, three
// satellites, four governed nodes — whose whole meaning is in the positions. A layout
// algorithm would move them, and the picture would stop saying anything.
//
// Coordinates come from the approved prototype's 940×330 viewBox. The satellite mini-nodes
// are the one thing the prototype hardcoded and this cannot: it drew nine invariants and
// four packs because that is what shipped that week. Both are laid on the SAME ELLIPTICAL
// ARCS the prototype's hand-placed nodes sat on (fitted from its own coordinates), so a
// harness with seven invariants or six packs draws the same picture, spaced to fit.
const HUB = { x: 330, y: 165, r: 76 }
const ONTOLOGY = { x: 126, y: 95, r: 46 }
const INVARIANTS = { x: 560, y: 78, r: 42 }
const DOCTRINES = { x: 560, y: 252, r: 42 }

// The arcs the mini-nodes ride, in degrees, fitted from the prototype's placements:
// invariants sweep left-to-right over their node, packs sweep down its left flank.
const INV_ARC = { rx: 118, ry: 68, from: -134, to: -12 }
const PACK_ARC = { rx: 110, ry: 62, from: 216, to: 109 }

// Evenly spaced points along an arc. A single node sits at the midpoint rather than at the
// start — one invariant hanging off the left end would read as the first of a row that
// failed to render.
function arcPoints(node, arc, n) {
  if (n <= 0) return []
  const out = []
  for (let i = 0; i < n; i += 1) {
    const t = n === 1 ? (arc.from + arc.to) / 2 : arc.from + ((arc.to - arc.from) * i) / (n - 1)
    const rad = (t * Math.PI) / 180
    out.push({ x: node.x + arc.rx * Math.cos(rad), y: node.y + arc.ry * Math.sin(rad) })
  }
  return out
}

// A tappable node: the group carries the click, and a focusable rect-free <g> is not
// keyboard-reachable, so each is a real button in the SVG's tab order.
function Node({ hash, label, children }) {
  return (
    <g
      className="cm-node"
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={() => go(hash)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          go(hash)
        }
      }}
    >
      {children}
    </g>
  )
}

// One of the four things the constitution governs, on the right-hand column.
function Governed({ x, y, r, label, count, hash }) {
  return (
    <Node hash={hash} label={`${label}: ${count}`}>
      <circle cx={x} cy={y} r={r} className="cm-gov-disc" />
      <text x={x} y={y - 2} textAnchor="middle" className="cm-gov-name">
        {label}
      </text>
      <text x={x} y={y + 10} textAnchor="middle" className="cm-gov-num">
        {count}
      </text>
    </Node>
  )
}

export default function ConstitutionMap({ overview }) {
  // The catalogue is what carries the per-rule class and the per-pack roster — the overview
  // deliberately does not (api.mjs says why: one source for the roster, and it is this one).
  // Fetched here so the map is the only thing that pays for it, and degrading to `null` just
  // means the satellites draw without their mini-nodes.
  const [laws, setLaws] = useState(null)
  useEffect(() => {
    let alive = true
    api
      .catalog('laws')
      .then((r) => alive && setLaws(r.items || []))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const counts = overview?.counts || {}
  const inForce = rulesInForce(counts)
  const invariants = (laws || []).filter((it) => it.tier === 'invariant')
  // Packs in catalogue order, each with the count of its rules THIS INSTALL switched on —
  // the same per-rule `active` the overview's `doctrines.rules` totals, so the mini-nodes
  // and the satellite's own number can never disagree.
  const packs = []
  for (const it of (laws || []).filter((x) => x.tier === 'doctrine')) {
    let p = packs.find((q) => q.id === it.pack)
    if (!p) packs.push((p = { id: it.pack, title: it.packTitle || it.pack, on: 0 }))
    if (it.active !== false) p.on += 1
  }
  const invPts = arcPoints(INVARIANTS, INV_ARC, invariants.length)
  const packPts = arcPoints(DOCTRINES, PACK_ARC, packs.length)

  return (
    <svg className="cmap" viewBox="0 0 940 330" role="img" aria-label="The constitution map">
      {/* Hub → satellite: the constitution IS these three tiers. Solid. */}
      <path d="M330 165 C260 140 220 125 158 105" className="cm-edge" />
      <path d="M330 165 C420 105 460 90 520 78" className="cm-edge" />
      <path d="M330 165 C420 225 460 240 520 252" className="cm-edge" />
      {/* Satellite → governed: the rules REACH these, which is a weaker relation than
          being made of them. Dashed, and labelled once at the top right. */}
      <path d="M598 78 C680 62 720 55 780 50" className="cm-edge-gov" />
      <path d="M598 78 C690 95 730 105 786 122" className="cm-edge-gov" />
      <path d="M598 252 C680 250 724 245 782 240" className="cm-edge-gov" />
      <path d="M598 252 C680 272 722 282 778 296" className="cm-edge-gov" />

      <Node hash="#/laws" label={`Constitution: ${inForce} rules in force`}>
        <circle cx={HUB.x} cy={HUB.y} r={HUB.r} className="cm-hub-disc" />
        <text x={HUB.x} y={HUB.y - 12} textAnchor="middle" className="cm-hub-name">
          Constitution
        </text>
        <text x={HUB.x} y={HUB.y + 8} textAnchor="middle" className="cm-hub-num">
          {inForce} rules in force
        </text>
        <text x={HUB.x} y={HUB.y + 24} textAnchor="middle" className="cm-note">
          {overview?.footprint === 'lean'
            ? 'lean ships each rule’s first line'
            : 'full text inlined'}
        </text>
      </Node>

      <Node hash="#/laws" label={`Ontology: ${counts.ontology ?? 0} sections`}>
        <circle cx={ONTOLOGY.x} cy={ONTOLOGY.y} r={ONTOLOGY.r} className="cm-sat-disc" />
        <text x={ONTOLOGY.x} y={ONTOLOGY.y - 7} textAnchor="middle" className="cm-sat-name">
          Ontology
        </text>
        <text x={ONTOLOGY.x} y={ONTOLOGY.y + 10} textAnchor="middle" className="cm-sat-num">
          {counts.ontology ?? 0} sections
        </text>
      </Node>
      <text x={ONTOLOGY.x} y={165} textAnchor="middle" className="cm-note">
        how it thinks — not a rule it can break
      </text>

      <Node hash="#/laws" label={`Invariants: ${counts.laws ?? 0}, never broken`}>
        <circle cx={INVARIANTS.x} cy={INVARIANTS.y} r={INVARIANTS.r} className="cm-sat-disc" />
        <text x={INVARIANTS.x} y={INVARIANTS.y - 5} textAnchor="middle" className="cm-sat-name">
          Invariants
        </text>
        <text x={INVARIANTS.x} y={INVARIANTS.y + 12} textAnchor="middle" className="cm-sat-num">
          {counts.laws ?? 0} · never broken
        </text>
      </Node>
      <g className="cm-mini">
        {invariants.map((it, i) => (
          <g key={it.name}>
            <circle
              cx={invPts[i].x}
              cy={invPts[i].y}
              r="8"
              className="cm-mini-disc"
              style={{ stroke: lawCatColor(it.klass) }}
            />
            <text
              x={invPts[i].x}
              y={invPts[i].y + 3}
              textAnchor="middle"
              style={{ fill: lawCatColor(it.klass) }}
            >
              {String(i + 1).padStart(2, '0')}
            </text>
          </g>
        ))}
      </g>
      <text x={INVARIANTS.x} y={132} textAnchor="middle" className="cm-note">
        one dot per rule, coloured by what it protects
      </text>

      <Node
        hash="#/laws"
        label={`Doctrines: ${counts.doctrines?.rules ?? 0} rules chosen at build`}
      >
        <circle cx={DOCTRINES.x} cy={DOCTRINES.y} r={DOCTRINES.r} className="cm-sat-disc" />
        <text x={DOCTRINES.x} y={DOCTRINES.y - 5} textAnchor="middle" className="cm-sat-name">
          Doctrines
        </text>
        <text x={DOCTRINES.x} y={DOCTRINES.y + 12} textAnchor="middle" className="cm-sat-num">
          {counts.doctrines?.rules ?? 0} · chosen at build
        </text>
      </Node>
      <g className="cm-mini">
        {packs.map((p, i) => (
          <g key={p.id}>
            <circle
              cx={packPts[i].x}
              cy={packPts[i].y}
              r="15"
              className="cm-pack-disc"
              style={{ stroke: lawCatColor(p.id) }}
            />
            <text x={packPts[i].x} y={packPts[i].y - 2} textAnchor="middle" className="cm-pack-id">
              {p.id.slice(0, 4)}
            </text>
            <text
              x={packPts[i].x}
              y={packPts[i].y + 8}
              textAnchor="middle"
              style={{ fill: lawCatColor(p.id) }}
            >
              {p.on}
            </text>
          </g>
        ))}
      </g>
      <text x={640} y={296} className="cm-note">
        {counts.doctrines
          ? `${counts.doctrines.active}/${counts.doctrines.total} packs lit — toggle per install`
          : ''}
      </text>

      <text x={800} y={20} className="cm-govern-label">
        GOVERNS THE HARNESS
      </text>
      <Governed x={812} y={50} r={26} label="Skills" count={counts.skills ?? 0} hash="#/skills" />
      <Governed x={820} y={122} r={26} label="Agents" count={counts.agents ?? 0} hash="#/agents" />
      <Governed
        x={816}
        y={240}
        r={26}
        label="Memory"
        count={counts.memory ?? 0}
        hash="#/section/memory"
      />
      <Governed
        x={812}
        y={304}
        r={24}
        label="Wiki"
        count={counts.wiki ?? 0}
        hash="#/section/wiki"
      />
      <text x={ONTOLOGY.x} y={220} textAnchor="middle" className="cm-note">
        tap any node to open its ledger
      </text>
    </svg>
  )
}
