import React, { useMemo, useState } from 'react'

// Force-relaxation + layout tuning for the constellation — the knobs that shape the
// preview. Values are empirical: a golden-angle spiral seed, then a brief relaxation
// of inverse-square repulsion + edge springs + a gentle centre pull.
const LAYOUT = {
  maxNodes: 28, // busiest-by-degree nodes shown
  goldenAngle: 2.39996, // rad (~137.5°) — even spiral spread
  seedRadiusScale: 0.42, // spiral radius as a fraction of the viewport
  iterations: 90,
  repulsion: 480, // inverse-square push between every pair
  springLength: 46, // target edge length
  springStiffness: 0.05,
  centrePull: 0.005, // drift back toward centre each step
  boundsMargin: { x: 16, y: 14 }, // keep nodes off the edges
  edgeCurve: { max: 20, scale: 0.14 }, // quadratic-bezier control-point offset
}

// Node radius = base (by type) + degree-scaled growth, capped. A node is a "hub"
// (gets a glow) when it has at least minDegree connections or >55% of the max degree.
const NODE = {
  baseRadius: { agent: 4, law: 3, skill: 3.2 },
  degreeScale: 0.45,
  degreeMax: 3.6,
  hubGlowScale: 3.2,
  hub: { minDegree: 3, maxFraction: 0.55 },
}

// A compact constellation preview of the cross-link graph. Nodes are selected
// and laid out by degree: the busiest hub anchors the centre, satellites
// orbit it via a brief deterministic force relaxation, and curved edges keep
// the visual readable. The full force-directed graph lives on the Graph page.
export default function MiniGraph({ graph }) {
  const W = 440
  const H = 230
  const [hover, setHover] = useState(null)

  const { nodes, edges, pos, degrees, maxDeg } = useMemo(() => {
    const empty = { nodes: [], edges: [], pos: new Map(), degrees: new Map(), maxDeg: 0 }
    if (!graph || !graph.nodes.length) return empty

    const degrees = new Map()
    graph.edges.forEach((e) => {
      degrees.set(e.source, (degrees.get(e.source) || 0) + 1)
      degrees.set(e.target, (degrees.get(e.target) || 0) + 1)
    })

    // Prioritise the most-connected nodes so the preview shows real structure
    // rather than the first 24 entries of an arbitrary list.
    const sorted = [...graph.nodes].sort(
      (a, b) => (degrees.get(b.id) || 0) - (degrees.get(a.id) || 0),
    )
    const nodes = sorted.slice(0, LAYOUT.maxNodes)
    const nodeIds = new Set(nodes.map((n) => n.id))
    const edges = graph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))

    // Golden-angle spiral seed: top hub at centre, others spread evenly out.
    const cx = W / 2
    const cy = H / 2
    const pos = new Map()
    nodes.forEach((n, i) => {
      if (i === 0) {
        pos.set(n.id, { x: cx, y: cy })
      } else {
        const a = i * LAYOUT.goldenAngle
        const r = Math.sqrt(i / nodes.length)
        pos.set(n.id, {
          x: cx + Math.cos(a) * r * (W * LAYOUT.seedRadiusScale),
          y: cy + Math.sin(a) * r * (H * LAYOUT.seedRadiusScale),
        })
      }
    })

    // Short force relaxation — repulsion + edge springs + centre pull.
    const arr = nodes.map((n) => pos.get(n.id))
    for (let it = 0; it < LAYOUT.iterations; it++) {
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i]
          const b = arr[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const d2 = dx * dx + dy * dy || 1
          const d = Math.sqrt(d2)
          const f = LAYOUT.repulsion / d2
          a.x += (dx / d) * f
          a.y += (dy / d) * f
          b.x -= (dx / d) * f
          b.y -= (dy / d) * f
        }
      }
      for (const e of edges) {
        const a = pos.get(e.source)
        const b = pos.get(e.target)
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        const f = (d - LAYOUT.springLength) * LAYOUT.springStiffness
        a.x += (dx / d) * f
        a.y += (dy / d) * f
        b.x -= (dx / d) * f
        b.y -= (dy / d) * f
      }
      for (const p of arr) {
        p.x += (cx - p.x) * LAYOUT.centrePull
        p.y += (cy - p.y) * LAYOUT.centrePull
        p.x = Math.max(LAYOUT.boundsMargin.x, Math.min(W - LAYOUT.boundsMargin.x, p.x))
        p.y = Math.max(LAYOUT.boundsMargin.y, Math.min(H - LAYOUT.boundsMargin.y, p.y))
      }
    }

    const maxDeg = Math.max(1, ...degrees.values())
    return { nodes, edges, pos, degrees, maxDeg }
  }, [graph])

  const neighbors = useMemo(() => {
    if (!hover) return null
    const n = new Set([hover])
    edges.forEach((e) => {
      if (e.source === hover) n.add(e.target)
      if (e.target === hover) n.add(e.source)
    })
    return n
  }, [hover, edges])

  if (!nodes.length) {
    return (
      <div
        style={{
          height: 200,
          display: 'grid',
          placeItems: 'center',
          color: 'var(--text-3)',
          fontSize: 13,
        }}
      >
        no cross-links yet
      </div>
    )
  }

  const hoverPos = hover ? pos.get(hover) : null
  const hoverNode = hover ? nodes.find((n) => n.id === hover) : null
  const hoverLabel = hoverNode?.type === 'law' ? `Rule ${hover}` : hover

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      role="img"
      aria-label="Cross-link constellation"
      onMouseLeave={() => setHover(null)}
    >
      <defs>
        <radialGradient id="mg-hub-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.42" />
          <stop offset="60%" stopColor="var(--accent)" stopOpacity="0.08" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {edges.map((e, i) => {
        const a = pos.get(e.source)
        const b = pos.get(e.target)
        if (!a || !b) return null
        const lit = hover && (e.source === hover || e.target === hover)
        const dimmed = hover && !lit
        const dx = b.x - a.x
        const dy = b.y - a.y
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const off = Math.min(LAYOUT.edgeCurve.max, len * LAYOUT.edgeCurve.scale)
        const mx = (a.x + b.x) / 2 + (-dy / len) * off
        const my = (a.y + b.y) / 2 + (dx / len) * off
        return (
          <path
            key={i}
            d={`M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`}
            fill="none"
            stroke={lit ? 'var(--accent)' : 'var(--line-2)'}
            strokeWidth={lit ? 1.3 : 0.9}
            opacity={dimmed ? 0.14 : lit ? 0.95 : 0.55}
          />
        )
      })}

      {nodes.map((n) => {
        const p = pos.get(n.id)
        if (!p) return null
        const deg = degrees.get(n.id) || 0
        const base = NODE.baseRadius[n.type] ?? NODE.baseRadius.skill
        const r = base + Math.min(NODE.degreeMax, deg * NODE.degreeScale)
        const isHub = deg >= Math.max(NODE.hub.minDegree, maxDeg * NODE.hub.maxFraction)
        const isOrphan = deg === 0
        const dim = neighbors && !neighbors.has(n.id)
        const fill =
          n.type === 'agent' ? 'var(--accent)' : n.type === 'law' ? 'var(--warn)' : 'var(--good)'
        return (
          <g
            key={n.id}
            opacity={dim ? 0.22 : 1}
            onMouseEnter={() => setHover(n.id)}
            style={{ cursor: 'pointer' }}
          >
            {isHub && (
              <circle cx={p.x} cy={p.y} r={r * NODE.hubGlowScale} fill="url(#mg-hub-glow)" />
            )}
            <circle
              cx={p.x}
              cy={p.y}
              r={r}
              fill={fill}
              fillOpacity={isOrphan ? 0.55 : 1}
              stroke="var(--bg)"
              strokeWidth="1.4"
            />
          </g>
        )
      })}

      {hoverPos && (
        <text
          x={hoverPos.x + (hoverPos.x > W - 90 ? -10 : 10)}
          y={hoverPos.y - 9}
          textAnchor={hoverPos.x > W - 90 ? 'end' : 'start'}
          fontSize="11"
          fill="var(--text)"
          style={{ paintOrder: 'stroke', stroke: 'var(--bg)', strokeWidth: 3 }}
        >
          {hoverLabel}
        </text>
      )}
    </svg>
  )
}
