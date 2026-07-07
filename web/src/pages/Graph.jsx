import React, { useMemo, useState } from 'react'
import { api } from '../api/index.js'
import { go } from '../lib/router.js'
import { romanToInt } from '../lib/roman.js'
import { useAsync } from '../hooks/useAsync.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'

// Three lenses on the same {nodes, edges}: an adjacency matrix, an arc diagram,
// and the layered network. The dense SVG children are built as React.createElement
// arrays (faithful to the design prototype, and far less noisy than JSX .map for
// hundreds of generated shapes). Node colours go through `style` rather than the
// `fill`/`stroke` attribute because var(--…) only resolves in CSS, not in SVG
// presentation attributes — so the graph restains live with the active theme.
const h = React.createElement
const COL = { agent: 'var(--accent)', skill: 'var(--good)', law: 'var(--warn)' }
// Labels stay app-consistent: laws read "Rule III" (the Laws ledger + catalog
// title both use "Rule"), agents/skills use their bare id.
const labelFor = (n) => (n.type === 'law' ? `Rule ${n.id}` : n.id)
const leave = (id, setHover) => setHover((cur) => (cur === id ? null : cur))

// Adjacency model: degrees (total/out/in), neighbour sets, and type-grouped
// node lists sorted the way each axis wants (laws by numeral, the rest by id).
function buildModel(G) {
  const byId = new Map(G.nodes.map((n) => [n.id, n]))
  const deg = new Map(G.nodes.map((n) => [n.id, 0]))
  const outDeg = new Map(G.nodes.map((n) => [n.id, 0]))
  const inDeg = new Map(G.nodes.map((n) => [n.id, 0]))
  const nbr = new Map(G.nodes.map((n) => [n.id, new Set()]))
  for (const e of G.edges) {
    deg.set(e.source, (deg.get(e.source) || 0) + 1)
    deg.set(e.target, (deg.get(e.target) || 0) + 1)
    outDeg.set(e.source, (outDeg.get(e.source) || 0) + 1)
    inDeg.set(e.target, (inDeg.get(e.target) || 0) + 1)
    nbr.get(e.source)?.add(e.target)
    nbr.get(e.target)?.add(e.source)
  }
  const ofType = (t) => G.nodes.filter((n) => n.type === t)
  const agents = ofType('agent').sort((a, b) => a.id.localeCompare(b.id))
  const skills = ofType('skill').sort((a, b) => a.id.localeCompare(b.id))
  const laws = ofType('law').sort((a, b) => romanToInt(a.id) - romanToInt(b.id))
  return { nodes: G.nodes, edges: G.edges, byId, deg, outDeg, inDeg, nbr, agents, skills, laws }
}

// ---- VIEW: ADJACENCY MATRIX ----
// Rectangular & degree-driven: rows = only nodes that cite something (out-edges),
// columns = only nodes that get cited (in-edges). Laws are pure targets, so they
// drop off the row axis entirely — no empty law rows. Filters remove axis members.
function matrixView({ M, c, hover, types, setHover, openNode }) {
  const all = [...M.agents, ...M.skills, ...M.laws]
  const rowNodes = all.filter((n) => M.outDeg.get(n.id) > 0 && types[n.type])
  const colNodes = all.filter((n) => M.inDeg.get(n.id) > 0 && types[n.type])
  const ri = new Map(rowNodes.map((n, i) => [n.id, i]))
  const ci = new Map(colNodes.map((n, i) => [n.id, i]))
  const cell = 11
  const gx = 160
  const gy = 170
  const W = gx + colNodes.length * cell + 24
  const H = gy + rowNodes.length * cell + 30
  const els = []
  // contiguous group bands present on an axis, in agent→skill→law order
  const bands = (list) => {
    const out = []
    let i = 0
    for (const [t, label] of [
      ['agent', 'AGENTS'],
      ['skill', 'SKILLS'],
      ['law', 'LAWS'],
    ]) {
      const cnt = list.filter((n) => n.type === t).length
      if (cnt > 0) {
        out.push({ label, color: COL[t], start: i, count: cnt })
        i += cnt
      }
    }
    return out
  }
  const rowBands = bands(rowNodes)
  const colBands = bands(colNodes)
  // hovered crosshair bands
  if (hover) {
    if (ri.has(hover))
      els.push(
        h('rect', {
          key: 'rb',
          x: gx,
          y: gy + ri.get(hover) * cell,
          width: colNodes.length * cell,
          height: cell,
          fill: 'rgba(255,255,255,.055)',
        }),
      )
    if (ci.has(hover))
      els.push(
        h('rect', {
          key: 'cb',
          x: gx + ci.get(hover) * cell,
          y: gy,
          width: cell,
          height: rowNodes.length * cell,
          fill: 'rgba(255,255,255,.055)',
        }),
      )
  }
  // separators between groups on each axis
  rowBands.slice(1).forEach((b, k) =>
    els.push(
      h('line', {
        key: 'hs' + k,
        x1: gx,
        y1: gy + b.start * cell,
        x2: gx + colNodes.length * cell,
        y2: gy + b.start * cell,
        style: { stroke: 'var(--line)' },
        strokeWidth: 1,
      }),
    ),
  )
  colBands.slice(1).forEach((b, k) =>
    els.push(
      h('line', {
        key: 'vs' + k,
        x1: gx + b.start * cell,
        y1: gy,
        x2: gx + b.start * cell,
        y2: gy + rowNodes.length * cell,
        style: { stroke: 'var(--line)' },
        strokeWidth: 1,
      }),
    ),
  )
  // cells — one dot per link, zero crossings
  for (const e of M.edges) {
    if (!ri.has(e.source) || !ci.has(e.target)) continue
    if (!c.shown(e.source) || !c.shown(e.target)) continue
    const r = ri.get(e.source)
    const col = ci.get(e.target)
    const lit = c.hasFocus
      ? hover
        ? e.source === hover || e.target === hover
        : c.matches(e.source) || c.matches(e.target)
      : true
    els.push(
      h(
        'rect',
        {
          key: e.source + '>' + e.target,
          x: gx + col * cell + 0.5,
          y: gy + r * cell + 0.5,
          width: cell - 1,
          height: cell - 1,
          rx: 1.5,
          style: { fill: COL[M.byId.get(e.source).type] },
          opacity: c.hasFocus ? (lit ? 0.95 : 0.07) : 0.82,
        },
        h('title', null, e.source + '  →  ' + labelFor(M.byId.get(e.target))),
      ),
    )
  }
  // row labels (left gutter)
  rowNodes.forEach((n, i) => {
    const fo = c.hasFocus && !c.nodeFocus(n.id)
    els.push(
      h(
        'text',
        {
          key: 'r' + n.id,
          x: gx - 8,
          y: gy + i * cell + cell - 3,
          textAnchor: 'end',
          fontSize: 8.6,
          style: { fill: fo ? 'var(--text-3)' : COL[n.type], cursor: 'pointer' },
          opacity: fo ? 0.32 : 1,
          onMouseEnter: () => setHover(n.id),
          onMouseLeave: () => leave(n.id, setHover),
          onClick: () => openNode(n),
        },
        labelFor(n),
      ),
    )
  })
  // column labels (rotated, top gutter)
  colNodes.forEach((n, i) => {
    const fo = c.hasFocus && !c.nodeFocus(n.id)
    const cx = gx + i * cell + cell - 3
    els.push(
      h(
        'text',
        {
          key: 'c' + n.id,
          x: cx,
          y: gy - 8,
          fontSize: 8.6,
          transform: `rotate(-90 ${cx} ${gy - 8})`,
          style: { fill: fo ? 'var(--text-3)' : COL[n.type], cursor: 'pointer' },
          opacity: fo ? 0.32 : 1,
          onMouseEnter: () => setHover(n.id),
          onMouseLeave: () => leave(n.id, setHover),
          onClick: () => openNode(n),
        },
        labelFor(n),
      ),
    )
  })
  // group axis labels
  rowBands.forEach((b, k) => {
    const my = gy + (b.start + b.count / 2) * cell
    els.push(
      h(
        'text',
        {
          key: 'gr' + k,
          x: 16,
          y: my,
          fontSize: 9.5,
          fontWeight: 600,
          letterSpacing: '.12em',
          style: { fill: b.color },
          opacity: 0.85,
          transform: `rotate(-90 16 ${my})`,
          textAnchor: 'middle',
        },
        b.label,
      ),
    )
  })
  colBands.forEach((b, k) =>
    els.push(
      h(
        'text',
        {
          key: 'gc' + k,
          x: gx + (b.start + b.count / 2) * cell,
          y: 18,
          fontSize: 9.5,
          fontWeight: 600,
          letterSpacing: '.12em',
          style: { fill: b.color },
          opacity: 0.85,
          textAnchor: 'middle',
        },
        b.label,
      ),
    ),
  )
  els.push(
    h(
      'text',
      {
        key: 'capR',
        x: gx - 8,
        y: gy - 150,
        fontSize: 8.5,
        style: { fill: 'var(--text-3)' },
        textAnchor: 'end',
      },
      'rows cite ↓',
    ),
  )
  els.push(
    h(
      'text',
      { key: 'capC', x: gx + 6, y: gy - 8, fontSize: 8.5, style: { fill: 'var(--text-3)' } },
      '→ are cited',
    ),
  )
  // Matrix is narrower than the canvas, so scale it to fill the width via the
  // viewBox (height follows the aspect). Arc/network stay natural-size + scroll.
  return h(
    'svg',
    {
      width: W,
      height: H,
      viewBox: `0 0 ${W} ${H}`,
      preserveAspectRatio: 'xMinYMin meet',
      className: 'gx-svg gx-fluid',
      onMouseLeave: () => setHover(null),
    },
    els,
  )
}

// ---- VIEW: ARC ----
// All nodes on one axis, grouped by type then by degree. Long arcs reach across
// the harness; the fan landing on the laws shows them as the shared backbone.
function arcView({ M, c, setHover, openNode }) {
  const order = []
  ;[M.agents, M.skills, M.laws].forEach((g) =>
    g
      .slice()
      .sort((x, y) => M.deg.get(y.id) - M.deg.get(x.id))
      .forEach((n) => order.push(n)),
  )
  const idx = new Map(order.map((n, i) => [n.id, i]))
  const step = 14
  const padL = 34
  const baseY = 330
  const maxH = 290
  const W = padL + order.length * step + 34
  const H = baseY + 170
  const els = []
  els.push(
    h('line', {
      key: 'axis',
      x1: padL - 8,
      y1: baseY,
      x2: padL + order.length * step,
      y2: baseY,
      style: { stroke: 'var(--line)' },
      strokeWidth: 1,
    }),
  )
  M.edges.forEach((e, i) => {
    if (!c.shown(e.source) || !c.shown(e.target)) return
    const xa = padL + idx.get(e.source) * step
    const xb = padL + idx.get(e.target) * step
    const hh = Math.min(maxH, 26 + Math.abs(xb - xa) * 0.42)
    const mx = (xa + xb) / 2
    const lit = c.edgeFocus(e)
    els.push(
      h('path', {
        key: 'a' + i,
        d: `M${xa},${baseY} Q${mx},${baseY - hh} ${xb},${baseY}`,
        fill: 'none',
        style: { stroke: COL[M.byId.get(e.source).type] },
        strokeWidth: lit && c.hasFocus ? 1.4 : 1,
        opacity: c.hasFocus ? (lit ? 0.85 : 0.035) : 0.16,
      }),
    )
  })
  order.forEach((n, i) => {
    const x = padL + i * step
    const off = !c.shown(n.id)
    const fo = c.hasFocus && !c.nodeFocus(n.id)
    const op = off ? 0.1 : fo ? 0.28 : 1
    const label = labelFor(n)
    els.push(
      h(
        'circle',
        {
          key: 'd' + n.id,
          cx: x,
          cy: baseY,
          r: c.hasFocus && c.nodeFocus(n.id) ? 4 : 3,
          style: { fill: COL[n.type], cursor: 'pointer' },
          opacity: op,
          onMouseEnter: () => setHover(n.id),
          onMouseLeave: () => leave(n.id, setHover),
          onClick: () => openNode(n),
        },
        h('title', null, label + ' · ' + M.deg.get(n.id) + ' links'),
      ),
    )
    els.push(
      h(
        'text',
        {
          key: 't' + n.id,
          x,
          y: baseY + 12,
          fontSize: 8.4,
          transform: `rotate(90 ${x} ${baseY + 12})`,
          style: { fill: fo ? 'var(--text-3)' : COL[n.type], cursor: 'pointer' },
          opacity: op,
          onMouseEnter: () => setHover(n.id),
          onMouseLeave: () => leave(n.id, setHover),
          onClick: () => openNode(n),
        },
        label,
      ),
    )
  })
  // group brackets above the axis
  let start = 0
  ;[
    ['AGENTS', M.agents, COL.agent],
    ['SKILLS', M.skills, COL.skill],
    ['LAWS', M.laws, COL.law],
  ].forEach((g, k) => {
    if (g[1].length === 0) return
    const x0 = padL + start * step - 4
    const x1 = padL + (start + g[1].length - 1) * step + 4
    els.push(
      h('line', {
        key: 'gb' + k,
        x1: x0,
        y1: 14,
        x2: x1,
        y2: 14,
        style: { stroke: g[2] },
        strokeWidth: 2,
        opacity: 0.6,
      }),
    )
    els.push(
      h(
        'text',
        {
          key: 'gt' + k,
          x: (x0 + x1) / 2,
          y: 9,
          fontSize: 9.5,
          fontWeight: 600,
          letterSpacing: '.12em',
          style: { fill: g[2] },
          textAnchor: 'middle',
        },
        g[0],
      ),
    )
    start += g[1].length
  })
  return h(
    'svg',
    {
      width: W,
      height: H,
      viewBox: `0 0 ${W} ${H}`,
      className: 'gx-svg',
      onMouseLeave: () => setHover(null),
    },
    els,
  )
}

// ---- VIEW: NETWORK ----
// Layered columns (agents | laws | skills), sorted with the most-connected hubs
// on top. Links sit near-invisible until you focus a node, so the structure
// reads instead of a hairball.
function netView({ M, c, setHover, openNode }) {
  const cols = [
    { list: M.agents, x: 210, side: 'left', title: 'AGENTS', color: COL.agent },
    { list: M.laws, x: 560, side: 'mid', title: 'LAWS', color: COL.law },
    { list: M.skills, x: 910, side: 'right', title: 'SKILLS', color: COL.skill },
  ]
  const rowH = 22
  const top = 78
  const pos = new Map()
  cols.forEach((col) => {
    col.list
      .slice()
      .sort((a, b) => M.deg.get(b.id) - M.deg.get(a.id))
      .forEach((n, i) => pos.set(n.id, { x: col.x, y: top + i * rowH }))
  })
  const maxRows = Math.max(0, ...cols.map((col) => col.list.length))
  const W = 1120
  const H = top + maxRows * rowH + 30
  const els = []
  M.edges.forEach((e, i) => {
    const a = pos.get(e.source)
    const b = pos.get(e.target)
    if (!a || !b || !c.shown(e.source) || !c.shown(e.target)) return
    const lit = c.edgeFocus(e)
    const mx = (a.x + b.x) / 2
    els.push(
      h('path', {
        key: 'e' + i,
        d: `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`,
        fill: 'none',
        style: { stroke: COL[M.byId.get(e.source).type] },
        strokeWidth: lit && c.hasFocus ? 1.3 : 0.9,
        opacity: c.hasFocus ? (lit ? 0.8 : 0.025) : 0.16,
      }),
    )
  })
  cols.forEach((col, k) => {
    const anchor = col.side === 'left' ? 'end' : col.side === 'right' ? 'start' : 'middle'
    const hx = col.side === 'left' ? col.x + 6 : col.side === 'right' ? col.x - 6 : col.x
    els.push(
      h(
        'text',
        {
          key: 'h' + k,
          x: hx,
          y: 46,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '.14em',
          style: { fill: col.color },
          textAnchor: anchor,
        },
        col.title + ' · ' + col.list.length,
      ),
    )
  })
  cols.forEach((col) => {
    col.list.forEach((n) => {
      const p = pos.get(n.id)
      const off = !c.shown(n.id)
      const fo = c.hasFocus && !c.nodeFocus(n.id)
      const op = off ? 0.1 : fo ? 0.25 : 1
      const left = col.side === 'left'
      const label = labelFor(n)
      const lit = c.hasFocus && c.nodeFocus(n.id)
      const anchor = col.side === 'mid' ? 'start' : left ? 'end' : 'start'
      els.push(
        h(
          'g',
          {
            key: n.id,
            transform: `translate(${p.x},${p.y})`,
            style: { cursor: 'pointer' },
            onMouseEnter: () => setHover(n.id),
            onMouseLeave: () => leave(n.id, setHover),
            onClick: () => openNode(n),
          },
          h('circle', { r: lit ? 4.4 : 3.4, style: { fill: COL[n.type] }, opacity: op }),
          h(
            'text',
            {
              x: col.side === 'mid' ? 9 : left ? -9 : 9,
              y: 3,
              textAnchor: anchor,
              fontSize: 10.5,
              style: {
                fill: fo ? 'var(--text-3)' : lit ? 'var(--text)' : 'var(--text-2)',
                fontWeight: lit ? 600 : 400,
              },
              opacity: op,
            },
            label,
          ),
          h('title', null, label + ' · ' + M.deg.get(n.id) + ' links'),
        ),
      )
    })
  })
  return h(
    'svg',
    {
      width: W,
      height: H,
      viewBox: `0 0 ${W} ${H}`,
      className: 'gx-svg',
      onMouseLeave: () => setHover(null),
    },
    els,
  )
}

const VIEWS = { matrix: matrixView, arc: arcView, network: netView }
const TABS = [
  ['matrix', 'Matrix'],
  ['arc', 'Arc'],
  ['network', 'Network'],
]
const FILTERS = [
  ['agent', 'Agents'],
  ['skill', 'Skills'],
  ['law', 'Laws'],
]
const HINTS = {
  matrix:
    'Adjacency matrix: one dot per link, zero crossings. Rows are the things that cite (agents + skills); columns are the things that get cited (agents, skills, laws). Laws never cite, so they appear only as columns; that wide gold band is every agent and skill grounding itself in the universal laws. Hover a label to light its row + column.',
  arc: 'Arc diagram: every node on one axis, ordered by type then by how connected it is. Long arcs reach across the harness; the fan of arcs landing on the laws shows them as the shared backbone. Hover a node to isolate its arcs.',
  network:
    'Network: the familiar layered layout, but links sit near-invisible until you focus. Hover or search a node and only its connections light up, so the structure reads instead of a hairball. Columns are sorted with the most-connected hubs on top.',
}

export default function Graph() {
  const { data, error } = useAsync(() => api.graph(), []) // {nodes, edges}
  const [view, setView] = useState('matrix')
  const [query, setQuery] = useState('')
  const [hover, setHover] = useState(null)
  const [types, setTypes] = useState({ agent: true, skill: true, law: true })

  const M = useMemo(() => (data ? buildModel(data) : null), [data])

  if (error) return <ErrorState error={error} />
  if (!data || !M) return <Loading />

  // Every node deep-links to its own item view: laws → #/item/law/<roman> (opens
  // the ledger with that rule pre-expanded), agents/skills → the Library.
  const openNode = (n) => go(`#/item/${n.type}/${encodeURIComponent(n.id)}`)

  // Focus context shared by all three views: what's lit vs dimmed under the
  // current hover / search / type filters.
  const ql = query.trim().toLowerCase()
  const matches = (id) => !!ql && id.toLowerCase().includes(ql)
  const c = {
    hasFocus: !!hover || !!ql,
    matches,
    nodeFocus: (id) => {
      if (hover) return id === hover || !!M.nbr.get(hover)?.has(id)
      if (ql) return matches(id)
      return true
    },
    edgeFocus: (e) => {
      if (hover) return e.source === hover || e.target === hover
      if (ql) return matches(e.source) || matches(e.target)
      return true
    },
    shown: (id) => types[M.byId.get(id).type],
  }

  const activeView = VIEWS[view]({ M, c, hover, types, setHover, openNode })

  const visNodes = M.nodes.filter((n) => types[n.type]).length
  const visEdges = M.edges.filter(
    (e) => types[M.byId.get(e.source).type] && types[M.byId.get(e.target).type],
  ).length

  let readout
  if (hover) {
    const n = M.byId.get(hover)
    readout = `${labelFor(n)} · ${n.type} · ${M.deg.get(hover)} links`
  } else if (ql) {
    readout = `filtering “${query.trim()}”`
  } else {
    readout = `${visNodes} nodes · ${visEdges} links shown`
  }

  return (
    <>
      <div className="head-row mb-16">
        <div>
          <div className="eyebrow">constellation</div>
          <h1 className="h">Graph</h1>
          <p className="sub">
            Every agent, skill and law in the harness with the cross-links parsed from source. Three
            ways to read the same {M.edges.length} connections. Pick the lens that fits the
            question. Hover anything to trace what it touches.
          </p>
        </div>
        <div className="gx-stats mono">
          <div>
            <span>{M.nodes.length}</span> nodes
          </div>
          <div>
            <span>{M.edges.length}</span> links
          </div>
        </div>
      </div>

      <div className="card pad-md">
        <div className="gx-toolbar">
          <div className="seg">
            {TABS.map(([k, label]) => (
              <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>
                {label}
              </button>
            ))}
          </div>

          <span className="gx-search">
            <span className="gx-search-ic">⌕</span>
            <input
              type="text"
              className="graph-search"
              placeholder="search nodes…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </span>

          <div className="gx-filters">
            {FILTERS.map(([t, label]) => (
              <button
                key={t}
                className={`gx-filter ${types[t] ? '' : 'off'}`}
                onClick={() => setTypes((s) => ({ ...s, [t]: !s[t] }))}
                aria-pressed={types[t]}
              >
                <span className="dot" style={{ background: COL[t] }} />
                {label}
              </button>
            ))}
          </div>

          <div className="gx-readout">{readout}</div>
        </div>

        <div className="gx-canvas">
          <div className={`gx-inner${view === 'matrix' ? ' fluid' : ''}`}>{activeView}</div>
        </div>

        <p className="gx-hint">{HINTS[view]}</p>
      </div>
    </>
  )
}
