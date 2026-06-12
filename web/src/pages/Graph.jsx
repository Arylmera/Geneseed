import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { go } from '../router.js'

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
      vx: 0, vy: 0,
    })
  })
  const springs = edges
    .map((e) => [pos.get(e.source), pos.get(e.target)])
    .filter(([a, b]) => a && b)
  for (let it = 0; it < 250; it++) {
    const arr = [...pos.values()]
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j]
        let dx = a.x - b.x, dy = a.y - b.y
        const d2 = dx * dx + dy * dy || 1
        const d = Math.sqrt(d2)
        const f = 2400 / d2
        dx /= d; dy /= d
        a.vx += dx * f; a.vy += dy * f
        b.vx -= dx * f; b.vy -= dy * f
      }
    }
    for (const [a, b] of springs) {
      const dx = b.x - a.x, dy = b.y - a.y
      const d = Math.sqrt(dx * dx + dy * dy) || 1
      const f = (d - 110) * 0.02
      a.vx += (dx / d) * f; a.vy += (dy / d) * f
      b.vx -= (dx / d) * f; b.vy -= (dy / d) * f
    }
    for (const p of arr) {
      p.vx += (w / 2 - p.x) * 0.002
      p.vy += (h / 2 - p.y) * 0.002
      p.x += p.vx * 0.85; p.y += p.vy * 0.85
      p.vx *= 0.6; p.vy *= 0.6
      p.x = Math.max(40, Math.min(w - 40, p.x))
      p.y = Math.max(24, Math.min(h - 24, p.y))
    }
  }
  return pos
}

export default function Graph() {
  const [data, setData] = useState(null) // { nodes, edges }
  const [err, setErr] = useState('')
  const [hover, setHover] = useState(null) // node id

  useEffect(() => { api.graph().then(setData).catch((e) => setErr(e.message)) }, [])

  const W = 980
  const H = data ? Math.max(520, data.nodes.length * 16) : 520
  const pos = useMemo(
    () => (data ? layout(data.nodes, data.edges, W, H) : null),
    [data],
  )

  if (err) return <div className="container"><p className="badge warn">{err}</p></div>
  if (!data || !pos) return <div className="container">Loading…</div>

  const linked = new Set()
  data.edges.forEach((e) => { linked.add(e.source); linked.add(e.target) })
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
    <div className="container">
      <h2>Cross-link graph</h2>
      <p className="muted">
        Every <code>[[wikilink]]</code> between agents and skills. Hover to isolate a
        neighbourhood, click a node to open it — unlinked items are dimmed (orphans).
      </p>
      <p className="muted graph-legend">
        <span className="swatch" data-accent="blue" /> agent ·{' '}
        <span className="swatch" data-accent="green" /> skill ·{' '}
        {data.nodes.length} nodes, {data.edges.length} links
      </p>
      <div className="panel graph-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cross-link graph">
          {data.edges.map((e, i) => {
            const a = pos.get(e.source), b = pos.get(e.target)
            if (!a || !b) return null
            const lit = hover && (e.source === hover || e.target === hover)
            return (
              <line
                key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                className={`gedge ${lit ? 'lit' : ''} ${hover && !lit ? 'dim' : ''}`}
              />
            )
          })}
          {data.nodes.map((node) => {
            const p = pos.get(node.id)
            return (
              <g
                key={node.id}
                className={`gnode ${node.type} ${dimmed(node.id) ? 'dim' : ''}`}
                transform={`translate(${p.x},${p.y})`}
                onMouseEnter={() => setHover(node.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => go(`#/item/${node.type}/${encodeURIComponent(node.id)}`)}
              >
                <circle r="7" />
                <text dx="10" dy="4">{node.id}</text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
