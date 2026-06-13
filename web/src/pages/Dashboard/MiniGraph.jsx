import React, { useMemo } from 'react'

// A compact radial preview of the cross-link graph for the lineage view: up to
// 24 nodes laid out on two rings (agents inner, the rest outer) with their
// edges. The full force-directed graph lives on the Graph page.
export default function MiniGraph({ graph }) {
  const W = 440,
    H = 230
  const nodes = graph ? graph.nodes.slice(0, 24) : []
  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges = graph
    ? graph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    : []

  const pos = useMemo(() => {
    const p = new Map()
    nodes.forEach((n, i) => {
      const a = (i / (nodes.length || 1)) * Math.PI * 2
      const rad = n.type === 'agent' ? 64 : 100
      p.set(n.id, { x: W / 2 + Math.cos(a) * rad * 1.5, y: H / 2 + Math.sin(a) * rad })
    })
    return p
    // geometry is memoised once per graph identity on purpose — node list changes mean a new graph object
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph])

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {edges.map((e, i) => {
        const a = pos.get(e.source),
          b = pos.get(e.target)
        if (!a || !b) return null
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="var(--line-2)"
            strokeWidth="1"
          />
        )
      })}
      {nodes.map((n) => {
        const p = pos.get(n.id)
        if (!p) return null
        return (
          <circle
            key={n.id}
            cx={p.x}
            cy={p.y}
            r={n.type === 'agent' ? 5 : 3.4}
            fill={n.type === 'agent' ? 'var(--accent)' : 'var(--good)'}
            stroke="var(--bg)"
            strokeWidth="1.5"
          />
        )
      })}
    </svg>
  )
}
