import React, { useMemo, useState } from 'react'
import { api } from '../api/index.js'
import { go } from '../lib/router.js'
import { useAsync } from '../hooks/useAsync.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'

// Deterministic hand-rolled force layout (no library): circle seed, then a few
// hundred iterations of repulsion + edge springs + center pull. Small graphs
// (tens of nodes) settle in well under a frame's worth of work.
function layout(nodes, edges, w, h) {
  const pos = new Map()
  const n = nodes.length || 1
  nodes.forEach((node, i) => {
    const a = (2 * Math.PI * i) / n
    pos.set(node.id, {
      x: w / 2 + Math.cos(a) * w * 0.35,
      y: h / 2 + Math.sin(a) * h * 0.35,
      vx: 0,
      vy: 0,
    })
  })
  const springs = edges
    .map((e) => [pos.get(e.source), pos.get(e.target)])
    .filter(([a, b]) => a && b)
  for (let it = 0; it < 250; it++) {
    const arr = [...pos.values()]
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i],
          b = arr[j]
        let dx = a.x - b.x,
          dy = a.y - b.y
        const d2 = dx * dx + dy * dy || 1
        const d = Math.sqrt(d2)
        const f = 2400 / d2
        dx /= d
        dy /= d
        a.vx += dx * f
        a.vy += dy * f
        b.vx -= dx * f
        b.vy -= dy * f
      }
    }
    for (const [a, b] of springs) {
      const dx = b.x - a.x,
        dy = b.y - a.y
      const d = Math.sqrt(dx * dx + dy * dy) || 1
      const f = (d - 110) * 0.02
      a.vx += (dx / d) * f
      a.vy += (dy / d) * f
      b.vx -= (dx / d) * f
      b.vy -= (dy / d) * f
    }
    for (const p of arr) {
      p.vx += (w / 2 - p.x) * 0.002
      p.vy += (h / 2 - p.y) * 0.002
      p.x += p.vx * 0.85
      p.y += p.vy * 0.85
      p.vx *= 0.6
      p.vy *= 0.6
      p.x = Math.max(40, Math.min(w - 40, p.x))
      p.y = Math.max(24, Math.min(h - 24, p.y))
    }
  }
  return pos
}

export default function Graph() {
  const { data, error } = useAsync(() => api.graph(), []) // { nodes, edges }
  const [hover, setHover] = useState(null) // node id

  const W = 980
  const H = data ? Math.max(520, data.nodes.length * 16) : 520
  const pos = useMemo(
    () => (data ? layout(data.nodes, data.edges, W, H) : null),
    // H is derived from data, so [data] fully captures the layout inputs
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  )

  if (error) return <ErrorState error={error} />
  if (!data || !pos) return <Loading />

  const linked = new Set()
  data.edges.forEach((e) => {
    linked.add(e.source)
    linked.add(e.target)
  })
  const neighbors = new Set()
  if (hover) {
    neighbors.add(hover)
    data.edges.forEach((e) => {
      if (e.source === hover) neighbors.add(e.target)
      if (e.target === hover) neighbors.add(e.source)
    })
  }
  const dimmed = (id) => (hover ? !neighbors.has(id) : !linked.has(id))

  return (
    <>
      <div className="head-row" style={{ marginBottom: 14 }}>
        <div>
          <span className="eyebrow">cross-links</span>
          <h1 className="h">Graph</h1>
          <p className="sub">
            Every <code>[[wikilink]]</code> between agents and skills. Hover to isolate a
            neighbourhood; click a node to open it — unlinked items are dimmed (orphans).
          </p>
        </div>
        <div className="legend">
          <span>
            <span className="sw" style={{ background: 'var(--accent)' }} />
            agent
          </span>
          <span>
            <span className="sw" style={{ background: 'var(--good)' }} />
            skill
          </span>
          <span className="dim">
            {data.nodes.length} nodes · {data.edges.length} links
          </span>
        </div>
      </div>
      <div className="card graph-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cross-link graph">
          {data.edges.map((e, i) => {
            const a = pos.get(e.source),
              b = pos.get(e.target)
            if (!a || !b) return null
            const lit = hover && (e.source === hover || e.target === hover)
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className={`gedge ${lit ? 'lit' : ''} ${hover && !lit ? 'dim' : ''}`}
              />
            )
          })}
          {data.nodes.map((node) => {
            const p = pos.get(node.id)
            return (
              <g
                key={node.id}
                className={`gnode ${node.type} ${dimmed(node.id) ? 'dim' : ''} ${hover && neighbors.has(node.id) ? 'near' : ''}`}
                transform={`translate(${p.x},${p.y})`}
                onMouseEnter={() => setHover(node.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => go(`#/item/${node.type}/${encodeURIComponent(node.id)}`)}
              >
                <circle r={node.type === 'agent' ? 8 : 6} />
                <text dx="12" dy="4">
                  {node.id}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </>
  )
}
