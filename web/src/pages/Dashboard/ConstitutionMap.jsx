import React, { useEffect, useState } from 'react'
import { api } from '../../api/index.js'
import { go } from '../../lib/router.js'
import { packColor } from '../../lib/lawCats.js'
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
// ⚠ EVERY CIRCLE IS SIZED FROM ITS OWN TEXT, and the first version was not. It carried the
// prototype's hand-drawn radii, which were fitted to the prototype's strings in the
// prototype's font — so live data in a mono skin overflowed them: "9 · never broken" ran
// out past the Invariants rim on both sides, and the pack names were being truncated to
// four characters (`craf`, `rigo`, `proc`) to fit a circle that had been guessed at. The
// centres are still the approved composition; only the radii are computed.

// Advance width per character as a fraction of the font size. Sized for the WIDEST case the
// console can produce: four skins (Matrix, Cobalt, Operator, Neon) set --font-mono for
// everything, and JetBrains/Space Mono advance at ~0.6em. A proportional skin then sits
// comfortably inside its circle rather than being clipped — this estimate's error only ever
// makes a circle roomier, which is the safe direction to be wrong in.
const ADVANCE = 0.62
const textWidth = (s, size) => String(s).length * size * ADVANCE

// The radius that contains a stack of centred lines. NOT simply "widest line / 2 + pad":
// a line sitting off-centre is limited by the chord at its own height, not by the diameter,
// so each line's far CORNER is what has to fit. `dy` is the baseline offset from the centre;
// the 0.75/0.25 split approximates a glyph box around that baseline.
function fitRadius(lines, pad) {
  let r = 0
  for (const l of lines) {
    if (l.t === '' || l.t == null) continue
    const hw = textWidth(l.t, l.size) / 2
    r = Math.max(r, Math.hypot(hw, l.dy - l.size * 0.75), Math.hypot(hw, l.dy + l.size * 0.25))
  }
  return Math.ceil(r + pad)
}

// A curved edge from the RIM of `a` to the rim of `b`. Rim-to-rim rather than centre-to-
// centre because the hub's fill is translucent: a spoke drawn from the centre showed
// through it, so three lines crossed inside the Constitution circle. Recomputed from
// whatever radius the text produced, so it cannot come loose when a count gains a digit.
function edgePath(a, b, bow = 0) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.hypot(dx, dy) || 1
  const ux = dx / d
  const uy = dy / d
  const sx = a.x + ux * a.r
  const sy = a.y + uy * a.r
  const ex = b.x - ux * b.r
  const ey = b.y - uy * b.r
  const off = bow * d
  const n = (v) => v.toFixed(1)
  return (
    `M${n(sx)} ${n(sy)} C${n(sx + ux * d * 0.3 - uy * off)} ${n(sy + uy * d * 0.3 + ux * off)} ` +
    `${n(ex - ux * d * 0.3 - uy * off)} ${n(ey - uy * d * 0.3 + ux * off)} ${n(ex)} ${n(ey)}`
  )
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

export default function ConstitutionMap({ overview }) {
  // The catalogue is what carries the per-pack roster — the overview deliberately does not
  // (api.mjs says why: one source for the roster, and it is this one). Fetched here so the
  // map is the only thing that pays for it, and degrading to `null` just means the doctrine
  // satellite draws without its pack nodes.
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
  // Packs in catalogue order, each with the count of its rules THIS INSTALL switched on —
  // the same per-rule `active` the overview's `doctrines.rules` totals, so the pack nodes
  // and the satellite's own number can never disagree.
  const packs = []
  for (const it of (laws || []).filter((x) => x.tier === 'doctrine')) {
    let p = packs.find((q) => q.id === it.pack)
    if (!p) packs.push((p = { id: it.pack, on: 0 }))
    if (it.active !== false) p.on += 1
  }

  // ---- the composition: prototype centres, computed radii ----
  const footNote = overview?.footprint === 'lean' ? 'lean — first line only' : 'full text inlined'
  const hub = {
    x: 330,
    y: 165,
    r: fitRadius(
      [
        { t: 'Constitution', size: 17, dy: -12 },
        { t: `${inForce} rules in force`, size: 10, dy: 8 },
        { t: footNote, size: 8.5, dy: 24 },
      ],
      12,
    ),
  }
  const ontology = {
    x: 126,
    y: 95,
    r: fitRadius(
      [
        { t: 'Ontology', size: 12.5, dy: -7 },
        { t: `${counts.ontology ?? 0} sections`, size: 10, dy: 10 },
      ],
      11,
    ),
  }
  // ⚠ THE QUALIFIER MOVED OUT OF THE CIRCLE. "9 · never broken" and "23 · chosen at build"
  // were the two strings that overflowed, and sizing a circle to hold them made both
  // satellites nearly as large as the hub — which inverts the composition, since the hub is
  // supposed to dominate. The NUMBER is the fact worth reading at a glance; the phrase is a
  // caption, and it reads perfectly well underneath.
  const invariants = {
    x: 560,
    y: 78,
    r: fitRadius(
      [
        { t: 'Invariants', size: 12.5, dy: -6 },
        { t: `${counts.laws ?? 0}`, size: 13, dy: 12 },
      ],
      11,
    ),
  }
  const doctrines = {
    x: 560,
    y: 252,
    r: fitRadius(
      [
        { t: 'Doctrines', size: 12.5, dy: -6 },
        { t: `${counts.doctrines?.rules ?? 0}`, size: 13, dy: 12 },
      ],
      11,
    ),
  }
  const governedNode = (x, y, label, count) => ({
    x,
    y,
    label,
    count,
    r: fitRadius(
      [
        { t: label, size: 10.5, dy: -2 },
        { t: `${count}`, size: 9, dy: 10 },
      ],
      9,
    ),
  })
  const governed = [
    { ...governedNode(812, 52, 'Skills', counts.skills ?? 0), hash: '#/skills', from: invariants },
    { ...governedNode(820, 126, 'Agents', counts.agents ?? 0), hash: '#/agents', from: invariants },
    {
      ...governedNode(816, 232, 'Memory', counts.memory ?? 0),
      hash: '#/section/memory',
      from: doctrines,
    },
    {
      ...governedNode(812, 300, 'Wiki', counts.wiki ?? 0),
      hash: '#/section/wiki',
      from: doctrines,
    },
  ]
  // The pack nodes ride an ellipse on the doctrine satellite's free flank, each sized to its
  // own name — so `ops` is a small disc and `process` a larger one, and neither is abbreviated.
  const PACK_ARC = { rx: 122, ry: 68, from: 212, to: 112 }
  const packNodes = packs.map((p, i) => {
    const t =
      packs.length === 1
        ? (PACK_ARC.from + PACK_ARC.to) / 2
        : PACK_ARC.from + ((PACK_ARC.to - PACK_ARC.from) * i) / (packs.length - 1)
    const rad = (t * Math.PI) / 180
    return {
      ...p,
      x: doctrines.x + PACK_ARC.rx * Math.cos(rad),
      y: doctrines.y + PACK_ARC.ry * Math.sin(rad),
      r: fitRadius(
        [
          { t: p.id, size: 7.5, dy: -2 },
          { t: `${p.on}`, size: 7.5, dy: 8 },
        ],
        4,
      ),
    }
  })

  // role="group", NOT role="img". An `img` role makes the whole subtree presentational,
  // which prunes every one of the focusable role="button" nodes below out of the
  // accessibility tree — leaving a screen-reader user with silent tab stops inside a
  // graphic that announces one alt text. `group` keeps the name AND the children.
  return (
    <svg className="cmap" viewBox="0 0 940 350" role="group" aria-label="The constitution map">
      {/* Hub → satellite: the constitution IS these three tiers. Solid, and bowed so the
          three spokes fan apart instead of leaving the hub as one thick line. */}
      <path d={edgePath(hub, ontology, 0.05)} className="cm-edge" />
      <path d={edgePath(hub, invariants, -0.07)} className="cm-edge" />
      <path d={edgePath(hub, doctrines, 0.07)} className="cm-edge" />
      {/* Satellite → governed: the rules REACH these, which is a weaker relation than being
          made of them. Dashed, and labelled once at the top right. */}
      {governed.map((g) => (
        <path key={`e-${g.label}`} d={edgePath(g.from, g, 0.03)} className="cm-edge-gov" />
      ))}

      <Node hash="#/laws" label={`Constitution: ${inForce} rules in force`}>
        <circle cx={hub.x} cy={hub.y} r={hub.r} className="cm-hub-disc" />
        <text x={hub.x} y={hub.y - 12} textAnchor="middle" className="cm-hub-name">
          Constitution
        </text>
        <text x={hub.x} y={hub.y + 8} textAnchor="middle" className="cm-hub-num">
          {inForce} rules in force
        </text>
        <text x={hub.x} y={hub.y + 24} textAnchor="middle" className="cm-note">
          {footNote}
        </text>
      </Node>

      <Node hash="#/laws" label={`Ontology: ${counts.ontology ?? 0} sections`}>
        <circle cx={ontology.x} cy={ontology.y} r={ontology.r} className="cm-sat-disc" />
        <text x={ontology.x} y={ontology.y - 7} textAnchor="middle" className="cm-sat-name">
          Ontology
        </text>
        <text x={ontology.x} y={ontology.y + 10} textAnchor="middle" className="cm-sat-num">
          {counts.ontology ?? 0} sections
        </text>
      </Node>
      <text x={ontology.x} y={ontology.y + ontology.r + 16} textAnchor="middle" className="cm-note">
        how it thinks, not a rule
      </text>

      <Node hash="#/laws" label={`Invariants: ${counts.laws ?? 0}, never broken`}>
        <circle cx={invariants.x} cy={invariants.y} r={invariants.r} className="cm-sat-disc" />
        <text x={invariants.x} y={invariants.y - 6} textAnchor="middle" className="cm-sat-name">
          Invariants
        </text>
        <text x={invariants.x} y={invariants.y + 12} textAnchor="middle" className="cm-sat-big">
          {counts.laws ?? 0}
        </text>
      </Node>
      <text
        x={invariants.x}
        y={invariants.y + invariants.r + 16}
        textAnchor="middle"
        className="cm-note"
      >
        never broken
      </text>

      <Node
        hash="#/laws"
        label={`Doctrines: ${counts.doctrines?.rules ?? 0} rules chosen at build`}
      >
        <circle cx={doctrines.x} cy={doctrines.y} r={doctrines.r} className="cm-sat-disc" />
        <text x={doctrines.x} y={doctrines.y - 6} textAnchor="middle" className="cm-sat-name">
          Doctrines
        </text>
        <text x={doctrines.x} y={doctrines.y + 12} textAnchor="middle" className="cm-sat-big">
          {counts.doctrines?.rules ?? 0}
        </text>
      </Node>
      {/* Anchored to the RIGHT of the satellite, not centred under it: the pack discs ride
          the lower-left flank and a centred caption lay straight across them. */}
      <text x={doctrines.x + 22} y={doctrines.y + doctrines.r + 20} className="cm-note">
        {counts.doctrines
          ? `chosen at build · ${counts.doctrines.active}/${counts.doctrines.total} packs lit`
          : 'chosen at build'}
      </text>

      <g className="cm-mini">
        {packNodes.map((p) => (
          <g key={p.id}>
            <circle
              cx={p.x}
              cy={p.y}
              r={p.r}
              className="cm-pack-disc"
              style={{ stroke: packColor(p.id) }}
            />
            <text x={p.x} y={p.y - 2} textAnchor="middle" className="cm-pack-id">
              {p.id}
            </text>
            <text x={p.x} y={p.y + 8} textAnchor="middle" style={{ fill: packColor(p.id) }}>
              {p.on}
            </text>
          </g>
        ))}
      </g>

      <text x={866} y={16} textAnchor="middle" className="cm-govern-label">
        GOVERNS THE HARNESS
      </text>
      {governed.map((g) => (
        <Node key={g.label} hash={g.hash} label={`${g.label}: ${g.count}`}>
          <circle cx={g.x} cy={g.y} r={g.r} className="cm-gov-disc" />
          <text x={g.x} y={g.y - 2} textAnchor="middle" className="cm-gov-name">
            {g.label}
          </text>
          <text x={g.x} y={g.y + 10} textAnchor="middle" className="cm-gov-num">
            {g.count}
          </text>
        </Node>
      ))}
      <text x={ontology.x} y={228} textAnchor="middle" className="cm-note">
        tap any node to open its ledger
      </text>
    </svg>
  )
}
