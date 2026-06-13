import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/index.js'
import { go } from '../lib/router.js'
import { useAsync } from '../hooks/useAsync.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'

// Deterministic hand-rolled force layout. Nodes are pre-sorted by degree so the
// busiest hub anchors the centre; a golden-angle spiral seeds the rest, then a
// few hundred iterations of repulsion + edge springs + centre pull settle them.
function layout(nodes, edges, w, h) {
  const deg = new Map()
  for (const n of nodes) deg.set(n.id, 0)
  for (const e of edges) {
    if (deg.has(e.source)) deg.set(e.source, deg.get(e.source) + 1)
    if (deg.has(e.target)) deg.set(e.target, deg.get(e.target) + 1)
  }
  const sorted = [...nodes].sort((a, b) => (deg.get(b.id) || 0) - (deg.get(a.id) || 0))

  const cx = w / 2
  const cy = h / 2
  const pos = new Map()
  const N = Math.max(1, sorted.length)
  sorted.forEach((node, i) => {
    if (i === 0) {
      pos.set(node.id, { x: cx, y: cy, vx: 0, vy: 0 })
    } else {
      const a = i * 2.39996
      const r = Math.sqrt(i / N)
      pos.set(node.id, {
        x: cx + Math.cos(a) * r * (w * 0.45),
        y: cy + Math.sin(a) * r * (h * 0.45),
        vx: 0,
        vy: 0,
      })
    }
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
      p.vx += (cx - p.x) * 0.002
      p.vy += (cy - p.y) * 0.002
      p.x += p.vx * 0.85
      p.y += p.vy * 0.85
      p.vx *= 0.6
      p.vy *= 0.6
      p.x = Math.max(28, Math.min(w - 28, p.x))
      p.y = Math.max(20, Math.min(h - 20, p.y))
    }
  }
  return { pos, deg }
}

export default function Graph() {
  const { data, error } = useAsync(() => api.graph(), []) // { nodes, edges }
  const [hover, setHover] = useState(null)
  const [query, setQuery] = useState('')
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const svgRef = useRef(null)
  const dragRef = useRef(null)

  const W = 980
  // Bounded height: previously H grew linearly with node count, producing
  // 3000px-tall canvases for big graphs. Cap it and let zoom/pan explore.
  const H = data ? Math.max(560, Math.min(820, 420 + data.nodes.length * 3)) : 560

  const { pos, deg } = useMemo(
    () => (data ? layout(data.nodes, data.edges, W, H) : { pos: null, deg: null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  )

  // Hubs earn a permanent label so the topology reads at a glance. Threshold is
  // the degree of the ~sqrt(n)-th most connected node — adapts to graph size.
  const hubCutoff = useMemo(() => {
    if (!deg || !deg.size) return Infinity
    const all = [...deg.values()].sort((a, b) => b - a)
    const k = Math.max(3, Math.floor(Math.sqrt(all.length)))
    return all[Math.min(k, all.length - 1)] ?? Infinity
  }, [deg])

  const neighbors = useMemo(() => {
    if (!data || !hover) return null
    const n = new Set([hover])
    data.edges.forEach((e) => {
      if (e.source === hover) n.add(e.target)
      if (e.target === hover) n.add(e.source)
    })
    return n
  }, [data, hover])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!data || !q) return null
    return new Set(data.nodes.filter((n) => n.id.toLowerCase().includes(q)).map((n) => n.id))
  }, [data, query])

  // React 18 attaches onWheel as a passive listener, so preventDefault() is a
  // no-op there and the page scrolls underneath. Attach a native non-passive
  // wheel handler instead, and keep view in a ref so it's always current.
  const viewRef = useRef(view)
  viewRef.current = view
  useEffect(() => {
    const sv = svgRef.current
    if (!sv) return
    const handler = (e) => {
      e.preventDefault()
      const rect = sv.getBoundingClientRect()
      const sx = (e.clientX - rect.left) / rect.width
      const sy = (e.clientY - rect.top) / rect.height
      const v = viewRef.current
      const k = Math.max(0.6, Math.min(4, v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
      const wx = v.x + sx * (W / v.k)
      const wy = v.y + sy * (H / v.k)
      setView({ x: wx - sx * (W / k), y: wy - sy * (H / k), k })
    }
    sv.addEventListener('wheel', handler, { passive: false })
    return () => sv.removeEventListener('wheel', handler)
  }, [W, H])

  const onMouseDown = (e) => {
    // Skip pan when the press starts on a node — preserves click-to-open.
    if (e.button !== 0 || e.target.closest('g.gnode')) return
    dragRef.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
  }
  const onMouseMove = (e) => {
    const d = dragRef.current
    if (!d) return
    const sv = svgRef.current
    if (!sv) return
    const rect = sv.getBoundingClientRect()
    const dx = ((e.clientX - d.x) / rect.width) * (W / view.k)
    const dy = ((e.clientY - d.y) / rect.height) * (H / view.k)
    setView({ ...view, x: d.vx - dx, y: d.vy - dy })
  }
  const stopDrag = () => {
    dragRef.current = null
  }
  const resetView = () => setView({ x: 0, y: 0, k: 1 })
  const isPanned = view.k !== 1 || view.x !== 0 || view.y !== 0

  if (error) return <ErrorState error={error} />
  if (!data || !pos) return <Loading />

  const linked = new Set()
  data.edges.forEach((e) => {
    linked.add(e.source)
    linked.add(e.target)
  })
  const maxDeg = Math.max(1, ...deg.values())

  // Dimming priority: hover beats search beats idle (orphans-only).
  const dimmed = (id) => {
    if (neighbors) return !neighbors.has(id)
    if (matches) return !matches.has(id)
    return !linked.has(id)
  }
  const showLabel = (id, d) => {
    if (neighbors) return neighbors.has(id)
    if (matches) return matches.has(id)
    return d >= hubCutoff
  }

  const viewBox = `${view.x} ${view.y} ${W / view.k} ${H / view.k}`

  return (
    <>
      <div className="head-row" style={{ marginBottom: 14 }}>
        <div>
          <span className="eyebrow">cross-links</span>
          <h1 className="h">Graph</h1>
          <p className="sub">
            Every <code>[[wikilink]]</code> between agents and skills, plus every{' '}
            <code>Rule N</code> mention that lands on a real rule. Hover to isolate a neighbourhood,
            scroll to zoom, drag the empty space to pan — orphans dim out.
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
          <span>
            <span className="sw" style={{ background: 'var(--warn)' }} />
            rule
          </span>
          <span className="dim">
            {data.nodes.length} nodes · {data.edges.length} links
          </span>
        </div>
      </div>
      <div className="card graph-wrap">
        <div className="graph-toolbar">
          <input
            type="text"
            placeholder="find a node…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="graph-search"
          />
          {matches && (
            <span className="dim mono">
              {matches.size} match{matches.size === 1 ? '' : 'es'}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <span className="dim mono">{Math.round(view.k * 100)}%</span>
          {isPanned && (
            <button className="btn ghost sm" onClick={resetView}>
              reset view
            </button>
          )}
        </div>
        <svg
          ref={svgRef}
          viewBox={viewBox}
          role="img"
          aria-label="Cross-link graph"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={stopDrag}
          onMouseLeave={() => {
            stopDrag()
            setHover(null)
          }}
          style={{ cursor: dragRef.current ? 'grabbing' : 'grab' }}
        >
          <defs>
            <radialGradient id="g-hub-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.42" />
              <stop offset="60%" stopColor="var(--accent)" stopOpacity="0.08" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </radialGradient>
          </defs>

          {data.edges.map((e, i) => {
            const a = pos.get(e.source)
            const b = pos.get(e.target)
            if (!a || !b) return null
            const lit = hover && (e.source === hover || e.target === hover)
            const matchHit = matches && matches.has(e.source) && matches.has(e.target)
            const dim = (hover && !lit) || (!hover && matches && !matchHit)
            const dx = b.x - a.x
            const dy = b.y - a.y
            const len = Math.sqrt(dx * dx + dy * dy) || 1
            const off = Math.min(28, len * 0.12)
            const mx = (a.x + b.x) / 2 + (-dy / len) * off
            const my = (a.y + b.y) / 2 + (dx / len) * off
            return (
              <path
                key={i}
                d={`M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`}
                fill="none"
                className={`gedge ${lit ? 'lit' : ''} ${dim ? 'dim' : ''}`}
              />
            )
          })}

          {data.nodes.map((node) => {
            const p = pos.get(node.id)
            if (!p) return null
            const d = deg.get(node.id) || 0
            const baseR = node.type === 'agent' ? 7 : node.type === 'law' ? 5 : 5.5
            const r = baseR + Math.min(6, d * 0.55)
            const isHub = d >= Math.max(3, maxDeg * 0.55)
            const dim = dimmed(node.id)
            const near = neighbors && neighbors.has(node.id)
            const label = showLabel(node.id, d) || hover === node.id
            const displayName = node.type === 'law' ? `Rule ${node.id}` : node.id
            return (
              <g
                key={node.id}
                className={`gnode ${node.type} ${dim ? 'dim' : ''} ${near ? 'near' : ''}`}
                transform={`translate(${p.x},${p.y})`}
                onMouseEnter={() => setHover(node.id)}
                onClick={() => go(`#/item/${node.type}/${encodeURIComponent(node.id)}`)}
              >
                {isHub && <circle r={r * 3.2} fill="url(#g-hub-glow)" className="ghub" />}
                <circle r={r} />
                {label && (
                  <text dx={r + 5} dy="4">
                    {displayName}
                    {hover === node.id && d > 0 ? `  · ${d}` : ''}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
    </>
  )
}
