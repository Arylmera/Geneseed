import React, { useMemo, useState } from 'react'
import { forceSimulation, forceManyBody, forceLink, forceCenter } from 'd3-force'

// Layout tuning for the constellation — the knobs that shape the preview. d3-force runs
// the relaxation now (charge repulsion + link springs + a centring force); ticked
// synchronously (sim.stop(), then N manual .tick() calls) so the layout is ready the
// instant this renders, with no timer/animation-frame loop to wait on.
const LAYOUT = {
  maxNodes: 28, // busiest-by-degree nodes shown
  iterations: 150,
  chargeStrength: -220, // node repulsion (d3's charge force is signed; negative repels)
  linkDistance: 46, // target edge length
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

    const cx = W / 2
    const cy = H / 2

    // d3-force mutates plain {id} objects in place (adding x/y/vx/vy); `.stop()` keeps it
    // from scheduling its own animation-frame timer, and the manual tick loop below runs
    // it to completion synchronously, in this render.
    const sim = forceSimulation(nodes.map((n) => ({ id: n.id })))
      .force('charge', forceManyBody().strength(LAYOUT.chargeStrength))
      .force(
        'link',
        forceLink(edges.map((e) => ({ source: e.source, target: e.target })))
          .id((d) => d.id)
          .distance(LAYOUT.linkDistance),
      )
      .force('center', forceCenter(cx, cy))
      .stop()
    for (let i = 0; i < LAYOUT.iterations; i++) sim.tick()

    const pos = new Map()
    sim.nodes().forEach((n) => {
      pos.set(n.id, {
        x: Math.max(LAYOUT.boundsMargin.x, Math.min(W - LAYOUT.boundsMargin.x, n.x)),
        y: Math.max(LAYOUT.boundsMargin.y, Math.min(H - LAYOUT.boundsMargin.y, n.y)),
      })
    })

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
