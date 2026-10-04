// The Loops page's ring layout — pure geometry, no React, so the numbers are testable on
// their own (__tests__/loopRing.test.js writes them out).
//
// THE RING IS THE ITERATION. A loop template is a graph with one `iteration: true` loop; its
// head (nodes[0]) sits at the top and the iteration turns clockwise. An inner loop (apply ⇄
// test) is hung OUTSIDE the ring on its head, so the eye reads "the big turn, and the small
// retry beside it" — the approved v2 mockup. Which nodes leave the ring for an inner circle:
// a non-head member of an inner loop, unless it closes the iteration (an edge back to the
// head — `review` in bugfix, `test` in refactor), because the closing step is part of the big
// turn. A node goes to the SMALLEST inner loop that claims it.
//
// FLOW MODE is the escape hatch for graphs a ring cannot draw cleanly: no iteration loop,
// more than 8 iteration nodes, a node in more than three loops (three hung circles on one
// head collide), or an inner loop whose head left the ring. Left-to-right, each loop a box.
//
// layoutLoop(graph, bricks) -> { mode, width, height, center, nodes, arcs, inner, entry, exit }
//   nodes  [{ name, x, y, r, effect, gate, inner, human }]   gate: the engine's ⛨ validate step
//   arcs   [{ d, kind: 'ring' | 'inner' | 'flow' }]
//   inner  ring: [{ loop, cx, cy, r, label, lx, ly, anchor }]   flow: [{ loop, label, box }]
//   entry  [{ name, x, y, human }]   exit { from, x, y, d } | null
//   human  the brick's `gate: human` as its marker's title (humanGate), or null

const C = { x: 260, y: 190 }
const R = 110
const NR = 28 // node radius
const GR = 14 // gate radius
const IR = 44 // inner-circle radius
const rad = (a) => (a * Math.PI) / 180
const r1 = (v) => Math.round(v * 10) / 10
const pt = (a, r = R, c = C) => ({
  x: r1(c.x + r * Math.cos(rad(a))),
  y: r1(c.y + r * Math.sin(rad(a))),
})
// The angle an arc gives up at a node of radius r: the node itself, plus 3° of air.
const trim = (r) => (r / R) * (180 / Math.PI) + 3
const arc = (r, p1, p2, large = 0) => `M${p1.x},${p1.y} A${r},${r} 0 ${large} 1 ${p2.x},${p2.y}`
// Where the setup arrow stops: just short of the ring at 205°.
export const ENTRY_TO = r1(pt(205).x - 6)
// ponytail: text width estimated at 6.4px a character (11px UI font); measuring needs a DOM.
const textW = (s) => s.length * 6.4

// A brick's human gate as words — the marker's accessible title and the brick card's tag. A
// gate limited by `gateOn` stops only on those outcomes, so the label names them.
export function humanGate(brick) {
  if (brick?.gate !== 'human') return null
  return brick.gateOn?.length ? `Human gate on ${brick.gateOn.join(', ')}` : 'Human gate'
}

export function layoutLoop(graph, bricks = []) {
  const brickOf = (n) => bricks.find((b) => b.name === n)
  const effectOf = (n) => brickOf(n)?.effect ?? null
  const humanOf = (n) => humanGate(brickOf(n))
  const loops = graph.loops || []
  const it = loops.find((l) => l.iteration)
  if (!it || it.nodes.length > 8) return flow(graph, effectOf, humanOf)
  const depth = Math.max(...graph.nodes.map((n) => loops.filter((l) => l.nodes.includes(n)).length))
  const inner = loops.filter((l) => l !== it)
  if (depth > 3 || inner.some((l) => !l.nodes.every((n) => it.nodes.includes(n)))) {
    return flow(graph, effectOf, humanOf)
  }

  const head = it.nodes[0]
  const closes = new Set(graph.edges.filter((e) => e.to === head).map((e) => e.from))
  const claimed = new Map() // node -> the inner loop it is drawn on
  for (const l of [...inner].sort((a, b) => a.nodes.length - b.nodes.length)) {
    for (const n of l.nodes.slice(1)) {
      if (n !== head && !closes.has(n) && !claimed.has(n)) claimed.set(n, l)
    }
  }
  const ring = it.nodes.filter((n) => !claimed.has(n))
  if (ring.length < 2 || inner.some((l) => claimed.has(l.nodes[0]))) {
    return flow(graph, effectOf, humanOf)
  }

  // Ring slots, clockwise from the top; the gate goes at the midpoint before the iteration's
  // first mutate node (the engine validates once per iteration, before that node).
  const step = 360 / ring.length
  const slots = ring.map((name, i) => ({ name, a: -90 + i * step, r: NR }))
  const firstMut = slots.findIndex((s) => effectOf(s.name) === 'mutate')
  if (firstMut >= 0) {
    slots.splice(firstMut, 0, {
      name: 'validate',
      a: slots[firstMut].a - step / 2,
      r: GR,
      gate: true,
    })
  }
  const nodes = slots.map((s) => ({
    name: s.name,
    ...pt(s.a),
    r: s.r,
    effect: s.gate ? null : effectOf(s.name),
    gate: !!s.gate,
    inner: false,
    human: s.gate ? null : humanOf(s.name),
  }))
  const arcs = slots.map((s, i) => {
    const next = slots[(i + 1) % slots.length]
    const end = (i + 1 === slots.length ? next.a + 360 : next.a) - trim(next.r) - 2
    const start = s.a + trim(s.r)
    return { d: arc(R, pt(start), pt(end), end - start > 180 ? 1 : 0), kind: 'ring' }
  })

  // Inner circles, hung on their head: one loop on the head's own angle at R + 44 (the
  // mockup); two loops on one head side by side at ∓18° and R + 54, so they clear each other
  // and the ring. Own nodes sit on the circle opposite the head; two arrowed arcs show the turn.
  const placed = []
  const byHead = new Map()
  for (const l of inner) byHead.set(l.nodes[0], [...(byHead.get(l.nodes[0]) || []), l])
  for (const [h, ls] of byHead) {
    const hs = slots.find((s) => s.name === h)
    const hp = pt(hs.a)
    const pair = ls.length > 1
    ls.sort((a, b) => a.nodes.length - b.nodes.length).forEach((l, k) => {
      const c = pt(hs.a + (pair ? (k ? 18 : -18) : 0), R + (pair ? 54 : 44))
      const away = Math.atan2(c.y - hp.y, c.x - hp.x) * (180 / Math.PI) // head → centre
      const own = l.nodes.filter((n) => claimed.get(n) === l)
      own.forEach((n, j) => {
        const p = pt(away + (j - (own.length - 1) / 2) * 60, IR, c)
        nodes.push({
          name: n,
          ...p,
          r: NR,
          effect: effectOf(n),
          gate: false,
          inner: true,
          human: humanOf(n),
        })
      })
      const back = away + 180 // centre → head
      arcs.push({ d: arc(IR, pt(back + 42, IR, c), pt(back + 138, IR, c)), kind: 'inner' })
      arcs.push({ d: arc(IR, pt(back + 222, IR, c), pt(back + 318, IR, c)), kind: 'inner' })
      const label = `${l.nodes.join(l.nodes.length === 2 ? ' ⇄ ' : ' → ')} · max ${l.max}`
      // A lone circle carries its label underneath (the mockup); a pair puts each label
      // beside its own circle, clear of its own nodes, or the two would stack on each other.
      let lab = { lx: c.x, ly: c.y + IR + 20, anchor: 'middle' }
      if (pair) {
        const right = c.x >= C.x
        const reach = Math.max(
          IR,
          ...own.map((n) => {
            const p = nodes.find((x) => x.name === n)
            return Math.abs(p.x - c.x) + NR
          }),
        )
        lab = {
          lx: r1(c.x + (right ? reach + 8 : -reach - 8)),
          ly: r1(c.y + 4),
          anchor: right ? 'start' : 'end',
        }
      }
      placed.push({ loop: l.name, cx: c.x, cy: c.y, r: IR, label, ...lab })
    })
  }

  // Setup enters from the left at 205°, the last setup step nearest the ring.
  const ey = pt(205).y
  const setup = graph.nodes.filter((n) => !it.nodes.includes(n))
  const entry = setup.map((name, i) => ({
    name,
    x: 40,
    y: r1(ey - 44 * (setup.length - 1 - i)),
    human: humanOf(name),
  }))

  const closer = graph.edges.find((e) => e.to === '$close')?.from
  const cp = nodes.find((n) => n.name === closer)
  const exit = cp
    ? {
        from: closer,
        x: cp.x + 200,
        y: cp.y - 30,
        d: `M${cp.x + NR},${cp.y - 6} C${cp.x + 90},${cp.y - 40} ${cp.x + 170},${cp.y - 40} ${cp.x + 200},${cp.y - 30}`,
      }
    : null

  const right = Math.max(
    540,
    ...nodes.map((n) => n.x + n.r + 8),
    ...placed.map((p) => p.cx + p.r + 8),
    ...placed.map((p) =>
      p.anchor === 'start' ? p.lx + textW(p.label) + 8 : p.lx + textW(p.label) / 2 + 8,
    ),
  )
  const bottom = Math.max(
    300,
    ...nodes.map((n) => n.y + n.r + 12),
    ...placed.map((p) => Math.max(p.cy + p.r, p.ly) + 12),
  )
  return {
    mode: 'ring',
    width: Math.ceil(right),
    height: Math.ceil(bottom),
    center: { x: C.x, y: C.y, r: R },
    nodes,
    arcs,
    inner: placed,
    entry,
    exit,
  }
}

// Left to right in declaration order; each declared loop a box around its nodes, nested loops
// inside bigger ones (16px more air per loop they contain), `max N` above, the return arrow
// along its bottom edge.
function flow(graph, effectOf, humanOf) {
  const loops = graph.loops || []
  const padOf = (l) =>
    36 + 16 * loops.filter((o) => o !== l && o.nodes.every((n) => l.nodes.includes(n))).length
  const Y = Math.max(NR, ...loops.map(padOf)) + 30 // the outermost box's label clears the top
  const xs = new Map(graph.nodes.map((n, i) => [n, 60 + i * 100]))
  const nodes = graph.nodes.map((n) => ({
    name: n,
    x: xs.get(n),
    y: Y,
    r: NR,
    effect: effectOf(n),
    gate: false,
    inner: false,
    human: humanOf(n),
  }))
  const arcs = graph.nodes.slice(1).map((n, i) => ({
    d: `M${xs.get(graph.nodes[i]) + NR},${Y} L${xs.get(n) - NR - 4},${Y}`,
    kind: 'flow',
  }))
  const inner = loops.map((l) => {
    const pad = padOf(l)
    const lx = Math.min(...l.nodes.map((n) => xs.get(n)))
    const hx = Math.max(...l.nodes.map((n) => xs.get(n)))
    const box = { x: lx - pad, y: Y - pad, w: hx - lx + 2 * pad, h: 2 * pad }
    arcs.push({ d: `M${hx},${box.y + box.h} L${lx + 4},${box.y + box.h}`, kind: 'flow' })
    return { loop: l.name, label: `${l.name} · max ${l.max}`, box }
  })
  return {
    mode: 'flow',
    width: 60 + graph.nodes.length * 100,
    height: 2 * Y,
    center: null,
    nodes,
    arcs,
    inner,
    entry: [],
    exit: null,
  }
}
