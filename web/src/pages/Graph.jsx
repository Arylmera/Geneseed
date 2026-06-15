import React, { useMemo, useState } from 'react'
import { api } from '../api/index.js'
import { go } from '../lib/router.js'
import { useAsync } from '../hooks/useAsync.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'

// Layered column layout. Each node lives in exactly one column (its type):
// laws, then agents, then skills. Within a column the nodes stack vertically.
// Edges become bezier curves crossing the columns. The position of every node
// is fully deterministic — no physics, no jitter, stable on every render.
function layout(nodes, cols, rowH, top) {
  const groups = Object.fromEntries(cols.map((c) => [c.key, []]))
  for (const n of nodes) {
    const key = n.type === 'law' ? 'laws' : n.type === 'agent' ? 'agents' : 'skills'
    if (groups[key]) groups[key].push(n)
  }
  // Stable sort: laws by Roman→Arabic, others alphabetically by id.
  const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }
  const roman = (s) => {
    let t = 0
    for (let i = 0; i < s.length; i++) {
      const v = ROMAN[s[i]] || 0
      const nx = ROMAN[s[i + 1]] || 0
      t += nx > v ? -v : v
    }
    return t
  }
  groups.laws.sort((a, b) => roman(a.id) - roman(b.id))
  groups.agents.sort((a, b) => a.id.localeCompare(b.id))
  groups.skills.sort((a, b) => a.id.localeCompare(b.id))
  const pos = new Map()
  for (const col of cols) {
    const arr = groups[col.key] || []
    arr.forEach((n, i) => {
      pos.set(n.id, { x: col.x, y: top + i * rowH })
    })
  }
  const heights = cols.map((c) => (groups[c.key] || []).length * rowH)
  return { groups, pos, height: top + Math.max(...heights, 0) + 28 }
}

export default function Graph() {
  const { data, error } = useAsync(() => api.graph(), []) // {nodes, edges}
  const [hover, setHover] = useState(null)
  const [query, setQuery] = useState('')

  // Wider viewBox + columns spaced to give long agent/skill names room to
  // breathe without spilling into the next column. Law labels render as just
  // "Rule X" so they never overflow.
  const W = 1200
  const cols = useMemo(
    () => [
      // Agents sit leftmost and render their labels to the LEFT of the dot
      // (side: 'left') so edges leave from clean space instead of crossing the
      // long agent names. That needs ~100px of gutter, hence x: 200. Laws (the
      // hub) stay centred; skills stay right with labels flowing rightward.
      { key: 'agents', title: 'Agents', x: 200, accent: 'var(--accent)', side: 'left' },
      { key: 'laws', title: 'Laws', x: 500, accent: 'var(--warn)', side: 'right' },
      { key: 'skills', title: 'Skills', x: 840, accent: 'var(--good)', side: 'right' },
    ],
    [],
  )
  const rowH = 22
  const top = 64

  const { groups, pos, height } = useMemo(
    () => (data ? layout(data.nodes, cols, rowH, top) : { groups: {}, pos: new Map(), height: 240 }),
    [data, cols],
  )

  const neighbors = useMemo(() => {
    if (!data || !hover) return null
    const s = new Set([hover])
    data.edges.forEach((e) => {
      if (e.source === hover) s.add(e.target)
      if (e.target === hover) s.add(e.source)
    })
    return s
  }, [data, hover])

  const ql = query.trim().toLowerCase()

  if (error) return <ErrorState error={error} />
  if (!data) return <Loading />

  const nodeCount = data.nodes.length
  const edgeCount = data.edges.length

  // Click handler: every node deep-links to its own item view. Laws resolve to
  // #/item/law/<roman>, which opens the Laws ledger with that exact rule
  // pre-expanded (not the bare ledger); agents/skills open in the Library.
  const openNode = (n) => {
    go(`#/item/${n.type}/${encodeURIComponent(n.id)}`)
  }

  // Law labels stay short ("Rule III") so they don't overflow the column
  // gap. The column header already says "Laws"; the rule's title appears
  // in the Ledger one click away.
  const labelFor = (n) => (n.type === 'law' ? `Rule ${n.id}` : n.id)

  return (
    <>
      <div className="head-row mb-16">
        <div>
          <div className="eyebrow">constellation</div>
          <h1 className="h">Graph</h1>
          <p className="sub">
            Every item in the harness, grouped by layer, with the real cross-links parsed from each
            source file. Hover a node to trace what it touches; click to open it.
          </p>
        </div>
      </div>
      <div className="card graph-wrap pad-md">
        <div className="graph-toolbar">
          <input
            type="text"
            className="graph-search"
            placeholder="highlight…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="legend">
            <span>
              <span className="sw" style={{ background: 'var(--warn)' }} />
              laws
            </span>
            <span>
              <span className="sw" style={{ background: 'var(--accent)' }} />
              agents
            </span>
            <span>
              <span className="sw" style={{ background: 'var(--good)' }} />
              skills
            </span>
          </span>
          <span className="dim mono" style={{ marginLeft: 'auto' }}>
            {nodeCount} nodes · {edgeCount} links
          </span>
        </div>
        <div className="graph-scroll">
          {/* width=100% + preserveAspectRatio="xMinYMin meet" left-aligns the
              graph and lets it fill the container's width while preserving
              the viewBox aspect. Height is computed from aspect, so adding
              rows naturally extends the canvas downward without letterboxing
              left/right. */}
          <svg
            viewBox={`0 0 ${W} ${height}`}
            preserveAspectRatio="xMinYMin meet"
            width="100%"
            className="graph-svg"
            role="img"
            aria-label="Layered cross-link graph"
            onMouseLeave={() => setHover(null)}
          >
            {cols.map((c) => (
              <text
                key={c.key}
                x={c.side === 'left' ? c.x + 5 : c.x - 5}
                y={34}
                className="gcol-title"
                style={{ fill: c.accent, textAnchor: c.side === 'left' ? 'end' : 'start' }}
              >
                {c.title.toUpperCase()} · {(groups[c.key] || []).length}
              </text>
            ))}

            {data.edges.map((e, i) => {
              const a = pos.get(e.source)
              const b = pos.get(e.target)
              if (!a || !b) return null
              const lit = hover && (e.source === hover || e.target === hover)
              const dim = hover && !lit
              const mx = (a.x + b.x) / 2
              return (
                <path
                  key={i}
                  d={`M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`}
                  className={`gedge2 ${lit ? 'lit' : ''} ${dim ? 'dim' : ''}`}
                />
              )
            })}

            {cols.map((c) =>
              (groups[c.key] || []).map((n) => {
                const p = pos.get(n.id)
                if (!p) return null
                const label = labelFor(n)
                const match =
                  ql && (n.id.toLowerCase().includes(ql) || label.toLowerCase().includes(ql))
                const dim = (neighbors && !neighbors.has(n.id)) || (ql && !match)
                // Approximate label width so the invisible hit rect spans
                // the whole row — 6.5px per character at 11.5px mono is a
                // safe overestimate for hover. The visible circle + text
                // ride on top via pointer-events:none in CSS. Left-side
                // columns mirror the text + hit rect to the dot's left.
                const left = c.side === 'left'
                const hitW = 18 + label.length * 6.5
                return (
                  <g
                    key={n.id}
                    className={`gnode2 ${n.type} ${dim ? 'dim' : ''} ${match ? 'near' : ''}`}
                    transform={`translate(${p.x},${p.y})`}
                    onMouseEnter={() => setHover(n.id)}
                    onMouseLeave={() => setHover((cur) => (cur === n.id ? null : cur))}
                    onClick={() => openNode(n)}
                  >
                    <rect
                      className="ghit"
                      x={left ? 8 - hitW : -8}
                      y={-10}
                      width={hitW}
                      height={20}
                      rx={3}
                    />
                    <circle r="3.4" />
                    <text x={left ? -9 : 9} y="0.5" style={{ textAnchor: left ? 'end' : 'start' }}>
                      {label}
                    </text>
                    <title>{n.type === 'law' ? `Open Rule ${n.id} in the ledger` : 'Open in Library'}</title>
                  </g>
                )
              }),
            )}
          </svg>
        </div>
      </div>
    </>
  )
}
