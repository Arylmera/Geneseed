import { describe, it, expect } from 'vitest'
import { layoutLoop } from '../lib/loopRing.js'

// The shipped templates, as `/api/loops` hands them over (src/loops/*.json), and the
// effect of each brick they use — the only brick field the layout reads.
const BUGFIX = {
  name: 'bugfix',
  nodes: ['reproduce', 'identify', 'apply', 'test', 'review'],
  start: 'reproduce',
  edges: [
    { from: 'reproduce', on: 'pass', to: 'identify' },
    { from: 'reproduce', on: 'fail', to: '$stop' },
    { from: 'identify', on: 'more', to: 'apply' },
    { from: 'identify', on: 'done', to: '$close' },
    { from: 'apply', on: 'pass', to: 'test' },
    { from: 'test', on: 'fail', to: 'apply' },
    { from: 'test', on: 'pass', to: 'review' },
    { from: 'review', on: 'pass', to: 'identify' },
    { from: 'review', on: 'fail', to: 'apply' },
  ],
  loops: [
    {
      name: 'iterations',
      nodes: ['identify', 'apply', 'test', 'review'],
      max: 20,
      iteration: true,
    },
    { name: 'apply-test', nodes: ['apply', 'test'], max: 5 },
    { name: 'review-fix', nodes: ['apply', 'test', 'review'], max: 3 },
  ],
}
const REFACTOR = {
  name: 'refactor',
  nodes: ['baseline-green', 'identify', 'apply', 'test'],
  start: 'baseline-green',
  edges: [
    { from: 'baseline-green', on: 'pass', to: 'identify' },
    { from: 'identify', on: 'more', to: 'apply' },
    { from: 'identify', on: 'done', to: '$close' },
    { from: 'apply', on: 'pass', to: 'test' },
    { from: 'test', on: 'pass', to: 'identify' },
    { from: 'test', on: 'fail', to: 'apply' },
  ],
  loops: [
    { name: 'iterations', nodes: ['identify', 'apply', 'test'], max: 20, iteration: true },
    { name: 'apply-test', nodes: ['apply', 'test'], max: 5 },
  ],
}
const BRICKS = [
  { name: 'reproduce', effect: 'mutate' },
  { name: 'baseline-green', effect: 'read' },
  { name: 'identify', effect: 'read' },
  { name: 'apply', effect: 'mutate' },
  { name: 'test', effect: 'read' },
  { name: 'review', effect: 'read' },
]

const at = (layout, name) => {
  const n = layout.nodes.find((x) => x.name === name)
  return n && [n.x, n.y, n.r]
}
const ringNames = (layout) => layout.nodes.filter((n) => !n.inner).map((n) => n.name)

describe('layoutLoop — the ring', () => {
  // The approved mockup's geometry: centre (260, 190), R 110, node r 28. The ring carries the
  // iteration's head, the nodes that close the iteration (an edge back to the head: review),
  // and the nodes no inner loop claims; `test` is claimed by apply-test and leaves the ring.
  // Three ring nodes evenly spaced clockwise from the top: -90°, 30°, 150°.
  it('lays bugfix out as a ring, the head at the top and the gate before apply', () => {
    const l = layoutLoop(BUGFIX, BRICKS)
    expect(l.mode).toBe('ring')
    expect(l.center).toEqual({ x: 260, y: 190, r: 110 })
    expect(ringNames(l)).toEqual(['identify', 'validate', 'apply', 'review'])
    expect(at(l, 'identify')).toEqual([260, 80, 28])
    // One gate, at the midpoint (-30°) before the iteration's first mutate node — the engine
    // validates once per iteration, so a second mutate node would get no second gate.
    expect(l.nodes.filter((n) => n.gate)).toHaveLength(1)
    expect(at(l, 'validate')).toEqual([355.3, 135, 14])
    expect(at(l, 'apply')).toEqual([355.3, 245, 28])
    expect(at(l, 'review')).toEqual([164.7, 245, 28])
    expect(l.nodes.find((n) => n.name === 'apply').effect).toBe('mutate')
  })

  // Clockwise SVG arcs trimmed by each end's radius (r/R rad + 3°, 2° more at the head of the
  // arrow): identify→validate runs -72.416° → -42.292°. Four ring arcs (identify, validate,
  // apply, review, back to identify) and two arrowed arcs on each inner circle.
  it('draws one ring arc per ring gap and two on each inner circle', () => {
    const l = layoutLoop(BUGFIX, BRICKS)
    expect(l.arcs.filter((a) => a.kind === 'ring')).toHaveLength(4)
    expect(l.arcs.filter((a) => a.kind === 'inner')).toHaveLength(4)
    expect(l.arcs[0].d).toBe('M293.2,85.1 A110,110 0 0 1 341.4,116')
  })

  // apply heads BOTH inner loops, so the two circles are hung on either side of its angle
  // (30° ∓ 18°) at R + 54 = 164 instead of R + 44, far enough apart (101 > 88) not to
  // overlap and clear of the ring. The two-node loop reads "a ⇄ b"; the longer one reads as
  // the cycle it is. `test` is placed on apply-test's circle, opposite apply.
  it('hangs both of apply’s inner loops on apply, side by side', () => {
    const l = layoutLoop(BUGFIX, BRICKS)
    expect(l.inner).toEqual([
      expect.objectContaining({
        loop: 'apply-test',
        cx: 420.4,
        cy: 224.1,
        r: 44,
        label: 'apply ⇄ test · max 5',
      }),
      expect.objectContaining({
        loop: 'review-fix',
        cx: 369.7,
        cy: 311.9,
        r: 44,
        label: 'apply → test → review · max 3',
      }),
    ])
    expect(at(l, 'test')).toEqual([462.3, 210.7, 28])
    expect(l.nodes.find((n) => n.name === 'test').inner).toBe(true)
  })

  // Setup enters from the left at 205° (y = 190 + 110·sin 205° = 143.5); `done → close`
  // leaves from the node that owns the $close edge, ending 200 right and 30 up of it.
  it('enters with the setup nodes and exits from the head', () => {
    const l = layoutLoop(BUGFIX, BRICKS)
    expect(l.entry).toEqual([{ name: 'reproduce', x: 40, y: 143.5 }])
    expect(l.exit).toEqual(expect.objectContaining({ from: 'identify', x: 460, y: 50 }))
  })

  // refactor: test closes the iteration (test → identify), so it stays on the ring and
  // apply-test is hung on apply with no node of its own — a single inner loop, so it sits on
  // apply's own angle at R + 44 like the mockup.
  it('keeps a node that closes the iteration on the ring', () => {
    const l = layoutLoop(REFACTOR, BRICKS)
    expect(l.mode).toBe('ring')
    expect(ringNames(l)).toEqual(['identify', 'validate', 'apply', 'test'])
    expect(l.inner).toEqual([
      expect.objectContaining({ loop: 'apply-test', cx: 393.4, cy: 267, r: 44 }),
    ])
    expect(l.entry.map((e) => e.name)).toEqual(['baseline-green'])
  })
})

describe('layoutLoop — flow fallback', () => {
  // More than eight iteration nodes would crowd the ring: left-to-right boxes instead.
  it('falls back to flow for a nine-node iteration loop', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    const graph = {
      name: 'long',
      nodes,
      start: 'a',
      edges: nodes.map((n, i) => ({ from: n, on: 'pass', to: nodes[(i + 1) % 9] })),
      loops: [{ name: 'iterations', nodes, max: 20, iteration: true }],
    }
    const l = layoutLoop(graph, [])
    expect(l.mode).toBe('flow')
    expect(l.nodes.map((n) => [n.name, n.x])).toEqual(nodes.map((n, i) => [n, 60 + i * 100]))
    expect(l.inner).toEqual([
      expect.objectContaining({ loop: 'iterations', label: 'iterations · max 20' }),
    ])
  })

  // Three inner loops on one node is nesting depth 4 — no clean ring for it.
  it('falls back to flow when one node sits in more than three loops', () => {
    const graph = {
      ...BUGFIX,
      loops: [...BUGFIX.loops, { name: 'extra', nodes: ['apply', 'review'], max: 2 }],
    }
    expect(layoutLoop(graph, BRICKS).mode).toBe('flow')
  })
})
