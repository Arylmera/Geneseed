import { describe, it, expect } from 'vitest'
import { humanGate, layoutLoop } from '../lib/loopRing.js'

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
  // leaves from the node that owns the $close edge, ending 200 right and 30 up of it. An
  // entry carries `human` like a node does: null, reproduce has no human gate.
  it('enters with the setup nodes and exits from the head', () => {
    const l = layoutLoop(BUGFIX, BRICKS)
    expect(l.entry).toEqual([{ name: 'reproduce', x: 40, y: 143.5, human: null }])
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

// The shipped templates with a human gate, as `/api/loops` hands them over: adr-challenge
// stops for the user only when it passes (gateOn: ['pass']); spec stops on every outcome.
const ADR = {
  name: 'architecture-decision',
  nodes: ['identify', 'adr-draft', 'adr-challenge'],
  start: 'identify',
  edges: [
    { from: 'identify', on: 'more', to: 'adr-draft' },
    { from: 'identify', on: 'done', to: '$close' },
    { from: 'adr-draft', on: 'pass', to: 'adr-challenge' },
    { from: 'adr-challenge', on: 'pass', to: 'identify' },
    { from: 'adr-challenge', on: 'fail', to: 'adr-draft' },
  ],
  loops: [
    {
      name: 'iterations',
      nodes: ['identify', 'adr-draft', 'adr-challenge'],
      max: 8,
      iteration: true,
    },
    { name: 'challenge-fix', nodes: ['adr-draft', 'adr-challenge'], max: 3 },
  ],
}
const SPEC_FIRST = {
  name: 'spec-first-feature',
  nodes: ['spec', 'identify', 'apply', 'test', 'review', 'done-check'],
  start: 'spec',
  edges: [
    { from: 'spec', on: 'pass', to: 'identify' },
    { from: 'spec', on: 'fail', to: '$stop' },
    { from: 'identify', on: 'more', to: 'apply' },
    { from: 'identify', on: 'done', to: 'done-check' },
    { from: 'apply', on: 'pass', to: 'test' },
    { from: 'test', on: 'pass', to: 'review' },
    { from: 'test', on: 'fail', to: 'apply' },
    { from: 'review', on: 'pass', to: 'identify' },
    { from: 'review', on: 'fail', to: 'apply' },
    { from: 'done-check', on: 'pass', to: '$close' },
    { from: 'done-check', on: 'fail', to: 'identify' },
  ],
  loops: [
    {
      name: 'iterations',
      nodes: ['identify', 'apply', 'test', 'review', 'done-check'],
      max: 20,
      iteration: true,
    },
    { name: 'apply-test', nodes: ['apply', 'test'], max: 5 },
    { name: 'review-fix', nodes: ['apply', 'test', 'review'], max: 3 },
  ],
}
const GATED = [
  ...BRICKS,
  { name: 'adr-draft', effect: 'mutate' },
  { name: 'adr-challenge', effect: 'read', gate: 'human', gateOn: ['pass'] },
  { name: 'spec', effect: 'mutate', gate: 'human' },
  { name: 'done-check', effect: 'read' },
]
const humans = (l) => [...l.nodes, ...l.entry].filter((n) => n.human).map((n) => [n.name, n.human])

describe('layoutLoop — human gates', () => {
  // The label is the marker's accessible title: a gate on every outcome is "Human gate"; a
  // gate limited by gateOn names those outcomes. No gate, or another kind, is no marker.
  it('labels a brick by its human gate', () => {
    expect(humanGate({ gate: 'human' })).toBe('Human gate')
    expect(humanGate({ gate: 'human', gateOn: ['pass'] })).toBe('Human gate on pass')
    expect(humanGate({ gate: 'human', gateOn: ['pass', 'fail'] })).toBe('Human gate on pass, fail')
    expect(humanGate({ gate: 'human', gateOn: [] })).toBe('Human gate')
    expect(humanGate({})).toBe(null)
    expect(humanGate(undefined)).toBe(null)
  })

  // architecture-decision: only adr-challenge carries the marker, on pass; the engine's
  // validate gate before adr-draft is a separate node and never a human one.
  it('marks adr-challenge in architecture-decision, on pass', () => {
    const l = layoutLoop(ADR, GATED)
    expect(humans(l)).toEqual([['adr-challenge', 'Human gate on pass']])
    expect(l.nodes.find((n) => n.name === 'validate').human).toBe(null)
  })

  // spec-first-feature: spec is a setup step (it enters from the left), so the marker rides
  // on its entry; nothing on the ring is human-gated.
  it('marks the spec setup step in spec-first-feature', () => {
    const l = layoutLoop(SPEC_FIRST, GATED)
    expect(humans(l)).toEqual([['spec', 'Human gate']])
    expect(l.entry).toEqual([{ name: 'spec', x: 40, y: 143.5, human: 'Human gate' }])
  })

  // Flow mode carries the marker too: the same nine-node iteration with its third node gated.
  it('marks a human-gated node in flow mode', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    const graph = {
      name: 'long',
      nodes,
      start: 'a',
      edges: nodes.map((n, i) => ({ from: n, on: 'pass', to: nodes[(i + 1) % 9] })),
      loops: [{ name: 'iterations', nodes, max: 20, iteration: true }],
    }
    const l = layoutLoop(graph, [{ name: 'c', effect: 'read', gate: 'human' }])
    expect(humans(l)).toEqual([['c', 'Human gate']])
  })
})

// api-endpoint, as `/api/loops` hands it over: apply heads two inner loops, and review-fix (the
// five-node one) owns two nodes of its own — bruno-test and security-scan (test is apply-test's,
// review closes the iteration). Spread 60° apart on a 44px circle they sat 44px apart, less than
// one node's diameter, so the console drew them on top of each other.
const API_ENDPOINT = {
  name: 'api-endpoint',
  nodes: ['plan', 'identify', 'apply', 'test', 'bruno-test', 'security-scan', 'review'],
  start: 'plan',
  edges: [
    { from: 'plan', on: 'pass', to: 'identify' },
    { from: 'identify', on: 'more', to: 'apply' },
    { from: 'identify', on: 'done', to: '$close' },
    { from: 'apply', on: 'pass', to: 'test' },
    { from: 'test', on: 'pass', to: 'bruno-test' },
    { from: 'test', on: 'fail', to: 'apply' },
    { from: 'bruno-test', on: 'pass', to: 'security-scan' },
    { from: 'bruno-test', on: 'fail', to: '$stop' },
    { from: 'security-scan', on: 'pass', to: 'review' },
    { from: 'security-scan', on: 'fail', to: 'apply' },
    { from: 'review', on: 'pass', to: 'identify' },
    { from: 'review', on: 'fail', to: 'apply' },
  ],
  loops: [
    {
      name: 'iterations',
      nodes: ['identify', 'apply', 'test', 'bruno-test', 'security-scan', 'review'],
      max: 20,
      iteration: true,
    },
    { name: 'apply-test', nodes: ['apply', 'test'], max: 5 },
    {
      name: 'review-fix',
      nodes: ['apply', 'test', 'bruno-test', 'security-scan', 'review'],
      max: 3,
    },
  ],
}
const API_BRICKS = [
  ...BRICKS,
  { name: 'plan', effect: 'read' },
  { name: 'bruno-test', effect: 'mutate' },
  { name: 'security-scan', effect: 'read' },
]

describe('layoutLoop — a crowded inner circle', () => {
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
  // A node's name is drawn centred on it, 11.5px semibold: ~6.4px a character, 14px tall.
  const box = (n) => ({ x: n.x - n.name.length * 3.2, w: n.name.length * 6.4, y: n.y - 7, h: 14 })
  const meets = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

  // review-fix's circle is the pair's second, centred (369.7, 311.9); its two own nodes fan out
  // either side of the head→centre direction (77.9°), 105° apart — the first 5° step whose chord
  // (2·44·sin 52.5° ≈ 70px) leaves 12px of air between two 28px nodes; their names clear too.
  it('puts review-fix’s own nodes on its circle, 105° apart, and test on apply-test’s', () => {
    const l = layoutLoop(API_ENDPOINT, API_BRICKS)
    expect(l.mode).toBe('ring')
    expect(ringNames(l)).toEqual(['identify', 'validate', 'apply', 'review'])
    const inner = l.nodes.filter((n) => n.inner).map((n) => n.name)
    expect(inner).toEqual(['test', 'bruno-test', 'security-scan'])
    expect(at(l, 'test')).toEqual([462.3, 210.7, 28])
    expect(at(l, 'bruno-test')).toEqual([409.5, 330.7, 28])
    expect(at(l, 'security-scan')).toEqual([341.2, 345.4, 28])
  })

  // No two nodes overlap: every pair (the ⛨ gate aside, it is smaller and between two ring
  // slots) is at least two node radii (56px) apart, centre to centre.
  it('keeps every pair of nodes at least two radii apart', () => {
    const l = layoutLoop(API_ENDPOINT, API_BRICKS)
    const ns = l.nodes.filter((n) => !n.gate)
    for (const a of ns) {
      for (const b of ns) {
        if (a !== b) expect(dist(a, b), `${a.name} ↔ ${b.name}`).toBeGreaterThanOrEqual(56)
      }
    }
    const [bruno, scan] = ['bruno-test', 'security-scan'].map((n) =>
      l.nodes.find((x) => x.name === n),
    )
    expect(dist(bruno, scan)).toBeGreaterThanOrEqual(2 * 28)
  })

  // Names wider than their node (security-scan is ~83px across a 56px node) must not run into
  // each other either: no two name boxes intersect.
  it('keeps the node names from colliding', () => {
    const l = layoutLoop(API_ENDPOINT, API_BRICKS)
    const ns = l.nodes.filter((n) => !n.gate)
    for (const a of ns) {
      for (const b of ns) {
        if (a !== b) expect(meets(box(a), box(b)), `${a.name} ↔ ${b.name}`).toBe(false)
      }
    }
  })
})
