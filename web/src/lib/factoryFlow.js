// The Factories page's graph layout — pure geometry, no React, so the numbers are testable on
// their own (__tests__/factoryFlow.test.js writes them out).
//
// A FACTORY READS LEFT TO RIGHT. Each stage takes the column of its longest path from `start`
// over the forward edges; stages sharing a column stack around one midline. `$close` is the end
// cap after the last column, on the midline. `$stop` sits under it, at the end of a rail every
// stage's stop edge drops into, so three "fail → stop" lines read as one bus, not a fan.
//
// A BACK EDGE IS THE ENGINE'S OWN: an edge into a cycle's first stage from a stage that cycle
// holds — the edge that spends a lap (`spends`, js/factory/graph.mjs). It is drawn as an arc above
// the row, from the top of its source to the top of its target. Removing those edges leaves the
// longest-path ranking acyclic for every graph `factory check` passes; for one it would refuse,
// the relaxation is capped at one pass per stage, so a stray cycle cannot spin.
//
// layoutFactory(factory, bricks) -> { width, height, nodes, edges }
//   nodes [{ id, x, y, w, h, kind, rank, loop, human, allow }]   x, y: the top-left; rank: column
//     kind  'brick' | 'loop' | 'triaged' | 'close' | 'stop'
//     loop  a `loop:<t>` stage's template name; allow: a `loop:$triaged` stage's allowlist
//     human a `gate: human` brick's badge title (humanGate), else null
//   edges [{ from, to, on, path, back, kind, lx, ly }]   one per from→to; `on` lists its outcomes
//     kind  'flow' | 'back' | 'skip' (a forward edge over a column, an arc below) | 'stop'
import { humanGate } from './loopRing.js'

const PAD = 24
const GAP = 64 // between columns: room for an outcome label
const ROW_GAP = 28
export const SIZE = {
  brick: { w: 132, h: 56 },
  loop: { w: 224, h: 196 },
  triaged: { w: 196, h: 92 },
  close: { w: 76, h: 36 },
  stop: { w: 76, h: 36 },
}
const LOOP = 'loop:'
const TRIAGED = 'loop:$triaged'

const kindOf = (s) => (s === TRIAGED ? 'triaged' : s.startsWith(LOOP) ? 'loop' : 'brick')
const lift = (span) => 36 + 14 * span

export function layoutFactory(factory, bricks = []) {
  const stages = Array.isArray(factory.stages) ? factory.stages : []
  const stageSet = new Set(stages)
  const edgesIn = (Array.isArray(factory.edges) ? factory.edges : []).filter(
    (e) => typeof e?.from === 'string' && typeof e?.to === 'string' && stageSet.has(e.from),
  )
  const cycles = (Array.isArray(factory.cycles) ? factory.cycles : []).filter((c) =>
    Array.isArray(c?.nodes),
  )
  const isBack = (e) => cycles.some((c) => c.nodes[0] === e.to && c.nodes.includes(e.from))
  const byName = new Map(bricks.map((b) => [b.name, b]))

  // Columns: the longest path from start over the forward stage → stage edges.
  const rank = new Map(stageSet.has(factory.start) ? [[factory.start, 0]] : [])
  const forward = edgesIn.filter((e) => stageSet.has(e.to) && !isBack(e))
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
  // A stage nothing reaches still gets drawn, one column each, after the reached ones.
  let last = Math.max(-1, ...rank.values())
  for (const s of stages) if (!rank.has(s)) rank.set(s, ++last)
  const endRank = last + 1
  const usesClose = edgesIn.some((e) => e.to === '$close')
  const usesStop = edgesIn.some((e) => e.to === '$stop')

  const nodes = stages.map((s) => {
    const kind = kindOf(s)
    return {
      id: s,
      kind,
      ...SIZE[kind],
      rank: rank.get(s),
      loop: kind === 'loop' ? s.slice(LOOP.length) : null,
      allow: kind === 'triaged' ? factory.loops || [] : null,
      human: kind === 'brick' ? humanGate(byName.get(s)) : null,
    }
  })
  if (usesClose) nodes.push({ id: '$close', kind: 'close', ...SIZE.close, rank: endRank })

  // Back arcs set the room above the row; skip arcs, the room below it.
  const node = new Map(nodes.map((n) => [n.id, n]))
  const span = (e) => Math.abs(node.get(e.to).rank - node.get(e.from).rank)
  const drawn = edgesIn.filter((e) => node.has(e.to))
  const above = Math.max(0, ...drawn.filter(isBack).map((e) => lift(span(e))))
  const skips = (e) => !isBack(e) && span(e) > 1
  const below = Math.max(0, ...drawn.filter(skips).map((e) => lift(span(e))))

  // Column x, then each node centred in its column and stacked about the midline.
  const cols = []
  for (const n of nodes) (cols[n.rank] ||= []).push(n)
  const colH = (c) => c.reduce((t, n) => t + n.h, 0) + ROW_GAP * (c.length - 1)
  const maxH = Math.max(SIZE.brick.h, ...cols.filter(Boolean).map(colH))
  const mid = PAD + above + maxH / 2
  let x = PAD
  for (const c of cols) {
    if (!c) continue
    const w = Math.max(...c.map((n) => n.w))
    let y = mid - colH(c) / 2
    for (const n of c) {
      n.x = x + (w - n.w) / 2
      n.y = y
      y += n.h + ROW_GAP
    }
    x += w + GAP
  }
  const rail = mid + maxH / 2 + below + 28
  if (usesStop) {
    const endX = usesClose ? node.get('$close').x : x
    const stop = { id: '$stop', kind: 'stop', ...SIZE.stop, rank: endRank, x: endX, y: rail - 18 }
    nodes.push(stop)
    node.set('$stop', stop)
  }

  // One edge per from → to: `merge-gate` says pass or none → retro is one line, two labels.
  const merged = new Map()
  for (const e of edgesIn) {
    if (!node.has(e.to)) continue
    const k = `${e.from}\u0000${e.to}`
    if (merged.has(k)) merged.get(k).on.push(e.on)
    else merged.set(k, { from: e.from, to: e.to, on: [e.on], back: isBack(e) })
  }
  const edges = [...merged.values()].map((e) => ({
    ...e,
    ...route(e, node.get(e.from), node.get(e.to)),
  }))
  return {
    width: Math.ceil(x - GAP + PAD),
    height: Math.ceil(usesStop ? rail + 18 + PAD : mid + maxH / 2 + below + PAD),
    nodes,
    edges,
  }

  function route(e, s, t) {
    const cx = (n) => n.x + n.w / 2
    const cy = (n) => n.y + n.h / 2
    const bot = (n) => n.y + n.h
    if (e.to === '$stop') {
      return {
        kind: 'stop',
        path: `M${cx(s)},${bot(s)} V${rail} H${t.x}`,
        lx: cx(s) + 6,
        ly: bot(s) + 14,
      }
    }
    if (e.back) {
      const apex = Math.min(s.y, t.y) - lift(span(e))
      return {
        kind: 'back',
        path: `M${cx(s)},${s.y} C${cx(s)},${apex} ${cx(t)},${apex} ${cx(t)},${t.y}`,
        lx: (cx(s) + cx(t)) / 2,
        // The cubic's peak at t = 0.5: 1/8 of each end, 3/4 of the shared control height.
        ly: (s.y + t.y) / 8 + (apex * 3) / 4 - 6,
      }
    }
    if (span(e) > 1) {
      const dip = Math.max(bot(s), bot(t)) + lift(span(e))
      return {
        kind: 'skip',
        path: `M${cx(s)},${bot(s)} C${cx(s)},${dip} ${cx(t)},${dip} ${cx(t)},${bot(t)}`,
        lx: (cx(s) + cx(t)) / 2,
        ly: (bot(s) + bot(t)) / 8 + (dip * 3) / 4 + 14,
      }
    }
    const [sx, sy, tx, ty] = [s.x + s.w, cy(s), t.x, cy(t)]
    const mx = (sx + tx) / 2
    return {
      kind: 'flow',
      path: sy === ty ? `M${sx},${sy} H${tx}` : `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`,
      lx: mx,
      ly: Math.min(sy, ty) - 8,
    }
  }
}
