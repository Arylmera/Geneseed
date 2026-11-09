// The Factories page's graph layout — pure geometry, no React, so the numbers are testable on
// their own (__tests__/factoryFlow.test.js writes them out).
//
// A FACTORY READS TOP TO BOTTOM (spec D10). A stage's rank is its longest forward distance from
// `start`, the routes back left out; each rank is one row, its stages side by side on one centre
// column. So the targets of a fork (a stage whose edges reach two or more stages) share a rank
// and sit side by side as LANES, and the stage every lane reaches sits below them: the join.
// Rows are joined by a bus: down from the source to the middle of the gap, across, down into the
// target. `$close` is the end cap under the last row.
//
// A BACK EDGE IS THE ENGINE'S OWN: an edge into a cycle's first stage from a stage that cycle
// holds (or, for a cycle that holds `$lane`, from a lane) — the edge that spends a lap. When
// several cycles hold it, it spends the SMALLEST, and is labelled with it (`spentCycle`,
// js/factory/graph.mjs, mirrored below). Removing those leaves the
// ranking acyclic for every graph `factory check` passes; for one it would refuse, the relaxation
// is capped at one pass per stage. A route back is a RAIL on the left, labelled with its cycle;
// a target `$lane` (the lane the run took, D13) is drawn to the lane row of the nearest fork
// above. Every edge to `$stop` runs right into ONE rail on the right, ending at the `$stop` cap,
// except a lane's: a rail from a lane would cross the other lanes, so in every form a lane's stop
// edge is a tag under its box ("fail → stop"), as every rail is in the tags forms.
//
// THE GRAPH NEVER SCROLLS SIDEWAYS (D18). `opts.width` is the room the page has; the layout tries
// four forms and keeps the first that fits: rails with lanes side by side; TAGS with lanes side by
// side (each rail becomes a label line under the stage it leaves, so no rail needs a column);
// rails with STACKED lanes (a row too wide for the room becomes a vertical list, a spine on each
// side); tags with stacked lanes. Lanes side by side come first because they are the fork; the
// rails are its margins. The last form is kept even when it does not fit; the svg scales down.
//
// layoutFactory(factory, bricks, { width, lane })
//   -> { width, height, mode, stacked, nodes, edges }
//   lane   the lane a live run took (laneTaken), where a stacked `$lane` rail lands
//   mode   'rails' | 'tags'; stacked: some row's lanes are stacked
//   nodes  [{ id, kind, x, y, w, h, rank, lane, stacked, loop, human, tags }]
//     kind  'brick' | 'fork' | 'loop' | 'close' | 'stop'; a loop stage is a compact box, as a
//           lane is: its loop named, never its ring
//     lane  in a row of two or more (drawn as a compact lane box); stacked: in a stacked row
//     tags  [{ kind: 'back' | 'stop' | 'skip', on, to, cycle }]: the tags forms' rails, and a
//           lane's stop edges in every form
//   edges  [{ from, to, on, kind, back, cycle, path, lx, ly, anchor }]   one per from → to
//     kind  'flow' | 'back' | 'skip' (a forward edge over a row) | 'stop'; path null: drawn as a
//           tag on its source
import { humanGate } from './loopRing.js'

const PAD = 24
const ROW_GAP = 48 // between rows: the bus and an outcome label
const LANE_GAP = 16
// The tags forms are the narrow ones: lanes there shrink to the room (LANE_MIN at least, the
// longest shipped lane name, `deps-upgrade`, still on one line), on a tighter gap and side pad.
const LANE_MIN = 92
const LANE_GAP_TIGHT = 8
const PAD_TIGHT = 16
const STACK_GAP = 22 // between stacked lanes: room for the outcome label above each
const SPINE = 14 // a stacked row's spine, each side
const RAIL = 14 // between left rails
const TAG = 15 // one tag line under a stage
const CH = 7.2 // px per character of an 11px mono label, rounded up: an estimate, for room only
export const SIZE = {
  brick: { w: 200, h: 48 },
  fork: { w: 200, h: 48 },
  loop: { w: 200, h: 56 }, // a brick's width, a lane's height: its loop name over `whole loop`
  lane: { w: 150, h: 56 },
  close: { w: 96, h: 34 },
  stop: { w: 76, h: 34 },
}
const LOOP = 'loop:'
const STAGE_END = new Set(['$close', '$stop', '$lane'])

// A cycle's label; a malformed one (no name, no max) still draws, as a bare route back.
export const backLabel = (c, counters) => {
  if (!c?.name) return '↺ route back'
  const laps = counters ? `${counters[c.name] ?? 0} / ${c.max ?? '?'}` : `max ${c.max ?? '?'}`
  return `↺ ${c.name} · ${laps}`
}

// The cycle an edge from → to spends: the smallest declared cycle entered at `to` that holds
// `from` — or holds `$lane` while `from` is a lane. The engine's `spentCycle`, mirrored.
export function spentCycle(cycles, from, to, lanes) {
  let best = null
  for (const c of cycles) {
    if (!Array.isArray(c?.nodes) || c.nodes[0] !== to) continue
    if (!c.nodes.includes(from) && !(c.nodes.includes('$lane') && lanes.has(from))) continue
    if (!best || c.nodes.length < best.nodes.length) best = c
  }
  return best
}

// The forks of a factory: each stage whose forward edges reach two or more stages, with them.
export function forksOf(factory) {
  const stages = new Set(Array.isArray(factory.stages) ? factory.stages : [])
  const cycles = (factory.cycles || []).filter((c) => Array.isArray(c?.nodes))
  const isBack = (e) => cycles.some((c) => c.nodes[0] === e.to && c.nodes.includes(e.from))
  const out = new Map()
  for (const e of factory.edges || []) {
    if (!stages.has(e?.from) || !stages.has(e?.to) || isBack(e)) continue
    if (!out.has(e.from)) out.set(e.from, [])
    if (!out.get(e.from).includes(e.to)) out.get(e.from).push(e.to)
  }
  return new Map([...out].filter(([, t]) => t.length > 1))
}

// The lane a run took: the target of the outcome its most recent fork recorded (FACTORY.md's
// `history` holds `{ stage, outcome }` per transition), or null before any fork.
export function laneTaken(factory, history) {
  const forks = forksOf(factory)
  for (const h of [...(Array.isArray(history) ? history : [])].reverse()) {
    if (!forks.has(h?.stage) || !h.outcome) continue
    const e = (factory.edges || []).find((x) => x.from === h.stage && x.on === h.outcome)
    if (e && forks.get(h.stage).includes(e.to)) return e.to
  }
  return null
}

export function layoutFactory(factory, bricks = [], opts = {}) {
  const avail = opts.width > 0 ? Math.floor(opts.width) : Infinity
  const forms = [
    { rails: true, stack: false },
    { rails: false, stack: false },
    { rails: true, stack: true },
    { rails: false, stack: true },
  ]
  for (const f of forms) {
    const l = place(factory, bricks, f, avail, opts.lane)
    if (l.width <= avail || f === forms.at(-1)) return l
  }
}

function place(factory, bricks, form, avail, taken) {
  const stages = Array.isArray(factory.stages) ? factory.stages : []
  const stageSet = new Set(stages)
  const edgesIn = (Array.isArray(factory.edges) ? factory.edges : []).filter(
    (e) =>
      typeof e?.from === 'string' &&
      typeof e?.to === 'string' &&
      stageSet.has(e.from) &&
      (stageSet.has(e.to) || STAGE_END.has(e.to)),
  )
  const cycles = (Array.isArray(factory.cycles) ? factory.cycles : []).filter((c) =>
    Array.isArray(c?.nodes),
  )
  const byName = new Map(bricks.map((b) => [b.name, b]))
  const forks = forksOf(factory)
  const lanes = new Set([...forks.values()].flat())
  const cycleOf = (e) => spentCycle(cycles, e.from, e.to, lanes)

  // Ranks: the longest path from start over the forward stage → stage edges.
  const rank = new Map(stageSet.has(factory.start) ? [[factory.start, 0]] : [])
  const forward = edgesIn.filter((e) => stageSet.has(e.to) && !cycleOf(e))
  for (let pass = 0; pass < stages.length; pass++) {
    let moved = false
    for (const e of forward) {
      if (!rank.has(e.from)) continue
      const r = rank.get(e.from) + 1
      if (!(rank.get(e.to) >= r)) {
        rank.set(e.to, r)
        moved = true
      }
    }
    if (!moved) break
  }
  // A stage nothing reaches still gets drawn, one row each, after the reached ones.
  let last = Math.max(-1, ...rank.values())
  for (const s of stages) if (!rank.has(s)) rank.set(s, ++last)
  const endRank = last + 1

  const rows = []
  for (const s of stages) (rows[rank.get(s)] ||= []).push(s)
  const inLane = (s) => rows[rank.get(s)].length > 1
  const padX = form.rails ? PAD : PAD_TIGHT
  const gap = form.rails ? LANE_GAP : LANE_GAP_TIGHT
  const room = avail === Infinity ? Infinity : avail - 2 * padX
  const laneW = () => Math.max(SIZE.lane.w, Math.min(240, room - 2 * SPINE))
  // Side by side: full lanes with rails; in the tags forms, as wide as the room allows.
  const sideLaneW = (n) =>
    form.rails
      ? SIZE.lane.w
      : Math.max(LANE_MIN, Math.min(SIZE.lane.w, Math.floor((room - gap * (n - 1)) / n)))

  const nodes = stages.map((s) => {
    const lane = inLane(s)
    const loop = s.startsWith(LOOP) ? s.slice(LOOP.length) : null
    const kind = loop ? 'loop' : forks.has(s) ? 'fork' : 'brick'
    const size = lane
      ? { w: sideLaneW(rows[rank.get(s)].length), h: SIZE.lane.h }
      : { ...(SIZE[kind] || SIZE.brick) }
    return {
      id: s,
      kind,
      ...size,
      rank: rank.get(s),
      lane,
      stacked: false,
      loop,
      human: kind === 'brick' || kind === 'fork' ? humanGate(byName.get(s)) : null,
      tags: [],
    }
  })
  const node = new Map(nodes.map((n) => [n.id, n]))
  const usesClose = edgesIn.some((e) => e.to === '$close')
  if (usesClose) {
    const close = { id: '$close', kind: 'close', ...SIZE.close, rank: endRank, tags: [] }
    nodes.push(close)
    node.set('$close', close)
    rows[endRank] = ['$close']
  }

  // `$lane` drawn to the lane row of the nearest fork above the source.
  const fork = (from) => {
    let best = null
    for (const f of forks.keys()) {
      if (rank.get(f) < rank.get(from) && (!best || rank.get(f) > rank.get(best))) best = f
    }
    return best
  }

  // One edge per from → to: `merge-gate` says pass or none → retro is one line, two labels.
  const merged = new Map()
  for (const e of edgesIn) {
    const k = `${e.from}\u0000${e.to}`
    if (merged.has(k)) merged.get(k).on.push(e.on)
    else {
      const c = cycleOf(e)
      const target = e.to === '$lane' ? forks.get(fork(e.from))?.[0] : e.to
      if (e.to !== '$stop' && !node.has(target)) continue
      const span = e.to === '$stop' ? 0 : node.get(target).rank - rank.get(e.from)
      const kind = e.to === '$stop' ? 'stop' : c ? 'back' : span === 1 ? 'flow' : 'skip'
      merged.set(k, {
        from: e.from,
        to: e.to,
        target,
        on: [e.on],
        kind,
        back: !!c,
        cycle: c?.name ?? null,
        cycleDef: c,
        span,
      })
    }
  }
  const edges = [...merged.values()]
  const railed = edges.filter((e) => e.kind === 'back' || e.kind === 'skip')
  const laneStops = edges.filter((e) => e.kind === 'stop' && inLane(e.from))
  const tagged = form.rails
    ? laneStops
    : [...railed, ...edges.filter((x) => x.kind === 'stop' && !inLane(x.from)), ...laneStops]
  for (const e of tagged) {
    node.get(e.from).tags.push({ kind: e.kind, on: e.on, to: e.to, cycle: e.cycle })
  }
  const tagText = (t, e) =>
    t.kind === 'back'
      ? backLabel(e.cycleDef)
      : `${t.on.join(' · ')} → ${t.kind === 'stop' ? 'stop' : t.to}`
  const tagW = (n) =>
    Math.max(
      0,
      ...n.tags.map(
        (t) =>
          tagText(
            t,
            edges.find((e) => e.from === n.id && e.to === t.to),
          ).length * CH,
      ),
    )

  // Rows: widths, then stacked or side by side; x offsets relative to the content's left edge.
  const rowNodes = rows.map((r) => (r || []).map((s) => node.get(s)))
  const sideW = (r) => r.reduce((t, n) => t + n.w, 0) + gap * (r.length - 1)
  const stacked = rowNodes.map((r) => form.stack && r.length > 1 && sideW(r) > room)
  rowNodes.forEach((r, i) => {
    if (!stacked[i]) return
    for (const n of r) Object.assign(n, { stacked: true, w: laneW() })
  })
  const rowW = (r, i) => (stacked[i] ? Math.max(...r.map((n) => n.w)) + 2 * SPINE : sideW(r))
  const contentW = Math.max(SIZE.brick.w, ...rowNodes.map((r, i) => (r.length ? rowW(r, i) : 0)))

  let y = PAD
  const gapMid = []
  rowNodes.forEach((r, i) => {
    if (!r.length) return
    let x = (contentW - rowW(r, i)) / 2
    if (stacked[i]) {
      // Each stacked lane keeps its own tags under it, before the next lane's label.
      for (const n of r) {
        Object.assign(n, { x: (contentW - n.w) / 2, y })
        y += n.h + n.tags.length * TAG + STACK_GAP
      }
      y -= STACK_GAP
    } else {
      for (const n of r) {
        Object.assign(n, { x, y })
        x += n.w + gap
      }
      y += Math.max(...r.map((n) => n.h))
      y += Math.max(0, ...r.map((n) => n.tags.length)) * TAG
    }
    gapMid[i] = y + ROW_GAP / 2
    y += ROW_GAP
  })
  const bottom = y - ROW_GAP

  // Left rails, the longest span outermost, then the content pushed right until each rail's
  // label fits between its rail and its source.
  const drawnRails = form.rails ? railed.sort((a, b) => Math.abs(b.span) - Math.abs(a.span)) : []
  const railX = (i) => PAD + 4 + i * RAIL
  const railLabel = (e) => (e.back ? backLabel(e.cycleDef) : e.on.join(' · '))
  let x0 = drawnRails.length ? railX(drawnRails.length - 1) + 12 : padX
  drawnRails.forEach((e, i) => {
    x0 = Math.max(x0, railX(i) + 8 + railLabel(e).length * CH - node.get(e.from).x)
  })
  for (const n of nodes) n.x += x0

  // The stop rail on the right, past every stop label; its cap at the `$close` row.
  const drawnStops = form.rails ? edges.filter((e) => e.kind === 'stop' && !inLane(e.from)) : []
  let stopX = x0 + contentW + 24
  for (const e of drawnStops) {
    const s = node.get(e.from)
    stopX = Math.max(stopX, s.x + s.w + 10 + e.on.join(' · ').length * CH)
  }
  // A tag starts 6 px right of its stage's centre and may run past the stage: count it as room.
  const textRight = Math.max(
    0,
    ...nodes.filter((n) => n.tags.length).map((n) => n.x + n.w / 2 + 6 + tagW(n)),
  )
  let width = Math.max(x0 + contentW, textRight) + padX
  if (drawnStops.length) {
    stopX = Math.max(stopX, textRight + 10)
    const capY = usesClose ? node.get('$close').y : bottom - SIZE.stop.h
    const stop = {
      id: '$stop',
      kind: 'stop',
      ...SIZE.stop,
      x: stopX - SIZE.stop.w / 2,
      y: capY,
      rank: endRank,
      tags: [],
    }
    nodes.push(stop)
    node.set('$stop', stop)
    width = stopX + SIZE.stop.w / 2 + PAD
  }

  const cx = (n) => n.x + n.w / 2
  const cy = (n) => n.y + n.h / 2
  const bot = (n) => n.y + n.h
  const spineL = (n) => n.x - SPINE
  const spineR = (n) => n.x + n.w + SPINE
  const inFlow = new Map()
  for (const e of edges)
    if (e.kind === 'flow') inFlow.set(e.target, (inFlow.get(e.target) || 0) + 1)
  const intoTarget = new Map() // rails landing on one stage, spread around its middle

  const out = edges.map((e) => {
    const s = node.get(e.from)
    // `$lane` lands on the row's left edge; stacked, the lanes share one x, so it lands on the
    // lane the run took when one is known.
    const t =
      e.to === '$lane' && node.get(taken)?.stacked && forks.get(fork(e.from))?.includes(taken)
        ? node.get(taken)
        : node.get(e.target)
    const base = { from: e.from, to: e.to, on: e.on, kind: e.kind, back: e.back, cycle: e.cycle }
    if (e.kind === 'stop') {
      if (!drawnStops.includes(e)) return { ...base, path: null }
      const stop = node.get('$stop')
      return {
        ...base,
        path: `M${s.x + s.w},${cy(s)} H${stopX} V${stop.y}`,
        lx: s.x + s.w + 6,
        ly: cy(s) - 6,
        anchor: 'start',
      }
    }
    if (e.kind === 'back' || e.kind === 'skip') {
      const r = drawnRails.indexOf(e)
      if (r < 0) return { ...base, path: null }
      const k = intoTarget.get(t.id) || 0
      intoTarget.set(t.id, k + 1)
      const ty = cy(t) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 10
      return {
        ...base,
        path: `M${s.x},${cy(s)} H${railX(r)} V${ty} H${t.x}`,
        lx: railX(r) + 6,
        ly: cy(s) - 6,
        anchor: 'start',
      }
    }
    const gm = gapMid[s.rank]
    const exit = s.stacked
      ? `M${s.x + s.w},${cy(s)} H${spineR(s)} V${gm}`
      : `M${cx(s)},${bot(s)} V${gm}`
    const entry = t.stacked ? ` H${spineL(t)} V${cy(t)} H${t.x}` : ` H${cx(t)} V${t.y}`
    const plain = e.on.length === 1 && e.on[0] === 'pass'
    const lbl =
      (inFlow.get(t.id) || 0) > 1
        ? { lx: s.stacked ? spineR(s) + 4 : cx(s) + 6, ly: s.stacked ? cy(s) - 4 : bot(s) + 13 }
        : t.stacked
          ? { lx: t.x, ly: t.y - 5 }
          : { lx: cx(t) + 6, ly: t.y - 8 }
    return { ...base, path: exit + entry, ...lbl, anchor: 'start', plain }
  })
  return {
    width: Math.ceil(width),
    height: Math.ceil(bottom + PAD),
    mode: form.rails ? 'rails' : 'tags',
    stacked: stacked.some(Boolean),
    nodes,
    edges: out,
  }
}
