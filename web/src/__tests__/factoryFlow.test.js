import { describe, it, expect } from 'vitest'
import { layoutFactory, laneTaken, forksOf, backLabel } from '../lib/factoryFlow.js'
// A copy of src/factories/bug-report-to-fix.json, so the geometry pinned here moves only when
// this file does: intake → loop:bugfix → pr-open → merge-gate → retro → $close, three stages
// failing to $stop, and a red merge-gate routing back to loop:bugfix (cycle `ci`, max 2).
import factory from './fixtures/bug-report-to-fix.json'
// issue-to-pr with its fork (spec D11): triage names five lanes by outcome, each lane passes to
// holdout, and holdout and merge-gate route back to `$lane` (cycles holdout and ci, max 2 each).
import forked from './fixtures/issue-to-pr-forks.json'

const BRICKS = [
  { name: 'intake', outcomes: ['pass', 'fail'] },
  { name: 'merge-gate', outcomes: ['pass', 'fail', 'none'], gate: 'human' },
]
const l = layoutFactory(factory, BRICKS)
const at = (lay, id) => lay.nodes.find((n) => n.id === id)
const nums = (path) => path.match(/-?\d+(\.\d+)?/g).map(Number)
const LANES = ['loop:bugfix', 'loop:feature', 'loop:deps-upgrade', 'loop:refactor', 'docs-update']

describe('layoutFactory — a factory with no fork', () => {
  // Ranks by longest path from `start`, the back edge left out: one centre column, top to bottom.
  it('lays the stages out top to bottom on one centre column, $close last', () => {
    const xs = l.nodes.filter((n) => n.kind !== 'stop')
    expect(xs.map((n) => n.id)).toEqual([
      'intake',
      'loop:bugfix',
      'pr-open',
      'merge-gate',
      'retro',
      '$close',
    ])
    for (let i = 1; i < xs.length; i++) expect(xs[i].y).toBeGreaterThan(xs[i - 1].y + xs[i - 1].h)
    expect(new Set(xs.map((n) => n.x + n.w / 2)).size).toBe(1)
    expect([l.mode, l.stacked]).toEqual(['rails', false])
  })

  it('names each block by its kind', () => {
    expect(l.nodes.map((n) => [n.id, n.kind])).toEqual([
      ['intake', 'brick'],
      ['loop:bugfix', 'loop'],
      ['pr-open', 'brick'],
      ['merge-gate', 'brick'],
      ['retro', 'brick'],
      ['$close', 'close'],
      ['$stop', 'stop'],
    ])
    expect(at(l, 'loop:bugfix').loop).toBe('bugfix')
    // A loop stage on the main path is a compact box, never its ring: a brick's 200 px width, so
    // the column stays flush, and a lane's 56 px height, for its loop name over `whole loop`.
    expect([at(l, 'loop:bugfix').w, at(l, 'loop:bugfix').h]).toEqual([200, 56])
    expect(at(l, 'merge-gate').human).toBe('Human gate')
    expect(at(l, 'intake').human).toBeNull()
  })

  // One edge per from → to: merge-gate's pass and none both go to retro, so they are one line
  // with two labels. Only the route into the cycle's first stage from inside it is a back edge.
  it('merges parallel outcomes and flags the one route back', () => {
    expect(l.edges.map((e) => [e.from, e.to, e.on.join(','), e.kind, e.back])).toEqual([
      ['intake', 'loop:bugfix', 'pass', 'flow', false],
      ['intake', '$stop', 'fail', 'stop', false],
      ['loop:bugfix', 'pr-open', 'pass', 'flow', false],
      ['loop:bugfix', '$stop', 'fail', 'stop', false],
      ['pr-open', 'merge-gate', 'pass', 'flow', false],
      ['pr-open', '$stop', 'fail', 'stop', false],
      ['merge-gate', 'retro', 'pass,none', 'flow', false],
      ['merge-gate', 'loop:bugfix', 'fail', 'back', true],
      ['retro', '$close', 'pass', 'flow', false],
    ])
  })

  // The rail leaves merge-gate's left side, runs left of every block, climbs, and lands on
  // loop:bugfix's left side; its label sits between the rail and merge-gate.
  it('draws the route back as a rail on the left, labelled with its cycle', () => {
    const back = l.edges.find((e) => e.back)
    const [x0, y0, rx, ty, x1] = nums(back.path)
    const mg = at(l, 'merge-gate')
    const lb = at(l, 'loop:bugfix')
    expect([x0, y0]).toEqual([mg.x, mg.y + mg.h / 2])
    expect(rx).toBeLessThan(Math.min(...l.nodes.map((n) => n.x)))
    expect(rx).toBeGreaterThan(0)
    expect(ty).toBeGreaterThan(lb.y)
    expect(ty).toBeLessThan(lb.y + lb.h)
    expect(x1).toBe(lb.x)
    expect(back.cycle).toBe('ci')
    expect(back.lx).toBeGreaterThan(rx)
    expect(back.lx).toBeLessThan(mg.x)
  })

  // Every stop edge leaves its stage's right side into ONE rail on the right of every block; the
  // rail ends on the $stop cap, which sits beside $close on the last row.
  it('runs every stop edge into one rail on the right, ending at $stop', () => {
    const close = at(l, '$close')
    const stop = at(l, '$stop')
    expect(stop.y).toBe(close.y)
    const stops = l.edges.filter((x) => x.kind === 'stop')
    expect(stops).toHaveLength(3)
    const rail = stop.x + stop.w / 2
    const right = Math.max(...l.nodes.filter((n) => n.kind !== 'stop').map((n) => n.x + n.w))
    expect(rail).toBeGreaterThan(right)
    for (const e of stops) {
      const from = at(l, e.from)
      expect(e.path).toBe(`M${from.x + from.w},${from.y + from.h / 2} H${rail} V${stop.y}`)
    }
    expect(l.width).toBeGreaterThanOrEqual(stop.x + stop.w)
    expect(l.height).toBeGreaterThanOrEqual(stop.y + stop.h)
  })

  // At 400 px the rails do not fit: each becomes a tag under the stage it leaves, and the graph
  // is no wider than its room. The loop box already fits, so it keeps its 200 px.
  it('folds the rails into tags when the pane is narrow', () => {
    const n = layoutFactory(factory, BRICKS, { width: 400 })
    expect(n.mode).toBe('tags')
    expect(n.width).toBeLessThanOrEqual(400)
    expect(n.edges.filter((e) => e.kind !== 'flow').every((e) => e.path === null)).toBe(true)
    expect(at(n, 'merge-gate').tags).toEqual([
      { kind: 'back', on: ['fail'], to: 'loop:bugfix', cycle: 'ci' },
    ])
    expect(at(n, 'intake').tags.map((t) => [t.kind, t.on.join()])).toEqual([['stop', 'fail']])
    expect(at(n, '$stop')).toBeUndefined()
    expect(at(n, 'loop:bugfix').w).toBe(200)
  })

  // A forward edge over a row is no straight line through the block between: a rail on the left.
  it('routes a forward edge that skips a row as a rail, and tags it when narrow', () => {
    const g = {
      name: 's',
      start: 'a',
      stages: ['a', 'b', 'c'],
      edges: [
        { from: 'a', on: 'pass', to: 'b' },
        { from: 'a', on: 'none', to: 'c' },
        { from: 'b', on: 'pass', to: 'c' },
        { from: 'c', on: 'pass', to: '$close' },
      ],
    }
    const skip = layoutFactory(g)
    const e = skip.edges.find((x) => x.from === 'a' && x.to === 'c')
    expect(e.kind).toBe('skip')
    expect(nums(e.path)[2]).toBeLessThan(Math.min(...skip.nodes.map((n) => n.x)))
    expect(at(skip, '$stop')).toBeUndefined()
    const narrow = layoutFactory(g, [], { width: 260 })
    expect(at(narrow, 'a').tags).toEqual([{ kind: 'skip', on: ['none'], to: 'c', cycle: null }])
  })
})

describe('layoutFactory — a fork', () => {
  const f = layoutFactory(forked)

  it('finds the fork and its five lanes', () => {
    expect([...forksOf(forked)]).toEqual([['triage', LANES]])
    expect(at(f, 'triage').kind).toBe('fork')
  })

  // The fork's targets share one rank, side by side, in stage order; the join is below them.
  it('renders the lanes on one row, side by side, with the join below', () => {
    const lanes = LANES.map((id) => at(f, id))
    expect(new Set(lanes.map((n) => n.rank))).toEqual(new Set([3]))
    expect(new Set(lanes.map((n) => n.y)).size).toBe(1)
    expect(lanes.every((n) => n.lane && !n.stacked)).toBe(true)
    for (let i = 1; i < lanes.length; i++) {
      expect(lanes[i].x).toBeGreaterThan(lanes[i - 1].x + lanes[i - 1].w)
    }
    const join = at(f, 'holdout')
    expect(join.rank).toBe(4)
    expect(join.y).toBeGreaterThan(lanes[0].y + lanes[0].h)
    expect(at(f, 'triage').y + at(f, 'triage').h).toBeLessThan(lanes[0].y)
    // Each lane edge carries its own outcome; the lane boxes' kinds follow their stages.
    expect(
      f.edges.filter((e) => e.from === 'triage' && e.kind === 'flow').map((e) => e.on[0]),
    ).toEqual(['bug', 'feature', 'deps', 'refactor', 'docs'])
    expect(lanes.map((n) => n.kind)).toEqual(['loop', 'loop', 'loop', 'loop', 'brick'])
  })

  // Both routes back go to `$lane`: rails on the left, landing on the first lane, each with its
  // cycle; the longer (ci) runs outside the shorter (holdout).
  it('draws each route back to $lane as a left rail into the lane row', () => {
    const backs = f.edges.filter((e) => e.back)
    expect(backs.map((e) => [e.from, e.to, e.cycle])).toEqual([
      ['holdout', '$lane', 'holdout'],
      ['merge-gate', '$lane', 'ci'],
    ])
    const first = at(f, 'loop:bugfix')
    const [hx, , hr, hy, hx1] = nums(backs[0].path)
    const [, , cr, cyy, cx1] = nums(backs[1].path)
    expect(hx).toBe(at(f, 'holdout').x)
    expect([hx1, cx1]).toEqual([first.x, first.x])
    expect(cr).toBeLessThan(hr)
    expect(hr).toBeLessThan(first.x)
    for (const y of [hy, cyy]) {
      expect(y).toBeGreaterThan(first.y)
      expect(y).toBeLessThan(first.y + first.h)
    }
  })

  // Every stop edge is drawn (spec D10). The main path's run into the right rail; a lane's would
  // cross the other lanes, so each is a "fail → stop" tag under its lane box, in every form: the
  // four loop lanes carry one, docs-update (a brick lane with no stop edge) none.
  it('draws every stop edge: main path to the right rail, a lane as a tag under its box', () => {
    const drawn = f.edges.filter((e) => e.kind === 'stop' && e.path).map((e) => e.from)
    expect(drawn).toEqual(['intake', 'holdout-write', 'triage', 'holdout', 'pr-open'])
    expect(f.edges.filter((e) => e.kind === 'stop' && !e.path).map((e) => e.from)).toEqual(
      LANES.slice(0, 4),
    )
    for (const lay of [
      f,
      layoutFactory(forked, [], { width: 1531 }),
      layoutFactory(forked, [], { width: 560 }),
    ]) {
      expect(LANES.map((id) => at(lay, id).tags)).toEqual([
        [{ kind: 'stop', on: ['fail'], to: '$stop', cycle: null }],
        [{ kind: 'stop', on: ['fail'], to: '$stop', cycle: null }],
        [{ kind: 'stop', on: ['fail'], to: '$stop', cycle: null }],
        [{ kind: 'stop', on: ['fail'], to: '$stop', cycle: null }],
        [],
      ])
      // Each tag (from the box's centre + 6, about 80 px) stays inside the drawing.
      for (const id of LANES.slice(0, 4)) {
        const n = at(lay, id)
        expect(n.x + n.w / 2 + 6 + 'fail → stop'.length * 7.2).toBeLessThanOrEqual(lay.width)
      }
    }
  })

  // At 400 px the lane row cannot sit side by side: it stacks, each lane under the last, and the
  // rails become tags. The graph fits its room.
  it('stacks the lanes and tags the rails when the pane is narrow', () => {
    const n = layoutFactory(forked, [], { width: 400 })
    expect([n.mode, n.stacked]).toEqual(['tags', true])
    expect(n.width).toBeLessThanOrEqual(400)
    const lanes = LANES.map((id) => at(n, id))
    expect(lanes.every((x) => x.stacked)).toBe(true)
    expect(new Set(lanes.map((x) => x.x)).size).toBe(1)
    for (let i = 1; i < lanes.length; i++) {
      expect(lanes[i].y).toBeGreaterThan(lanes[i - 1].y + lanes[i - 1].h)
    }
    expect(at(n, 'holdout').y).toBeGreaterThan(lanes[4].y + lanes[4].h)
    expect(at(n, 'holdout').tags.map((t) => [t.kind, t.cycle ?? t.on.join()])).toEqual([
      ['back', 'holdout'],
      ['stop', 'error'],
    ])
    expect(at(n, 'merge-gate').tags.map((t) => t.cycle)).toEqual(['ci'])
  })

  // Stacked, every lane shares one x, so a rail to `$lane` can land on the lane the run took;
  // side by side it lands on the row's left edge, the first lane, whatever was taken. At 500 px
  // the compact lanes no longer fit side by side, and stacked lanes leave room for the rails.
  it('lands a stacked $lane rail on the lane the run took', () => {
    const n = layoutFactory(forked, [], { width: 500, lane: 'loop:refactor' })
    expect([n.mode, n.stacked]).toEqual(['rails', true])
    const r = at(n, 'loop:refactor')
    for (const e of n.edges.filter((x) => x.back)) {
      const [, , , ty, tx] = nums(e.path)
      expect(tx).toBe(r.x)
      expect(ty).toBeGreaterThan(r.y)
      expect(ty).toBeLessThan(r.y + r.h)
    }
    const wide = layoutFactory(forked, [], { lane: 'loop:refactor' })
    for (const e of wide.edges.filter((x) => x.back)) {
      expect(nums(e.path)[4]).toBe(at(wide, 'loop:bugfix').x)
    }
  })
})

// A fork must read as a fork (owner, F1): side by side beats rails. In a pane of about 560 px
// (spec D18's wide pane, a 1600 px window) the five lanes stay side by side as compact boxes,
// 99 px each on an 8 px gap, and the rails become tags. They stack only below 524 px.
describe('layoutFactory — a fork in a 560 px pane', () => {
  it('keeps the five lanes side by side, compact, in the tags form', () => {
    const n = layoutFactory(forked, [], { width: 560 })
    expect([n.mode, n.stacked]).toEqual(['tags', false])
    expect(n.width).toBeLessThanOrEqual(560)
    const lanes = LANES.map((id) => at(n, id))
    expect(new Set(lanes.map((x) => x.y)).size).toBe(1)
    expect(lanes.map((x) => x.w)).toEqual([99, 99, 99, 99, 99])
    for (let i = 1; i < lanes.length; i++) expect(lanes[i].x - lanes[i - 1].x).toBe(99 + 8)
    expect(n.edges.filter((e) => e.back).every((e) => e.path === null)).toBe(true)
    expect(at(n, '$stop')).toBeUndefined()
  })

  it('still fits side by side at 524 px, and stacks at 523', () => {
    expect(layoutFactory(forked, [], { width: 524 }).stacked).toBe(false)
    expect(layoutFactory(forked, [], { width: 523 }).stacked).toBe(true)
  })
})

// A back edge spends, and is labelled with, the SMALLEST declared cycle that holds it (the
// engine's spentCycle): holdout → $lane is in both cycles and spends `holdout`; merge-gate →
// $lane only in `ci`. Declaring the cycles the other way round changes nothing.
describe('the cycle a route back spends', () => {
  it('labels each route back with the smallest cycle holding it, in any declaration order', () => {
    const reversed = { ...forked, cycles: [...forked.cycles].reverse() }
    for (const g of [forked, reversed]) {
      const backs = layoutFactory(g).edges.filter((e) => e.back)
      expect(backs.map((e) => [e.from, e.cycle])).toEqual([
        ['holdout', 'holdout'],
        ['merge-gate', 'ci'],
      ])
      const tags = layoutFactory(g, [], { width: 400 })
      expect(at(tags, 'holdout').tags[0].cycle).toBe('holdout')
    }
  })

  // A hand-written cycle may lack a name or a max: the label still draws.
  it('labels a malformed cycle without crashing', () => {
    expect(backLabel({ name: 'ci', max: 2 })).toBe('↺ ci · max 2')
    expect(backLabel({ name: 'ci', max: 2 }, { ci: 1 })).toBe('↺ ci · 1 / 2')
    expect(backLabel({ nodes: ['a'], max: 2 })).toBe('↺ route back')
    expect(backLabel(undefined)).toBe('↺ route back')
    expect(backLabel({ name: 'x' })).toBe('↺ x · max ?')
    const g = {
      name: 'n',
      start: 'a',
      stages: ['a', 'b'],
      edges: [
        { from: 'a', on: 'pass', to: 'b' },
        { from: 'b', on: 'fail', to: 'a' },
        { from: 'b', on: 'pass', to: '$close' },
      ],
      cycles: [{ nodes: ['a', 'b'], max: 2 }],
    }
    expect(() => layoutFactory(g)).not.toThrow()
    expect(() => layoutFactory(g, [], { width: 300 })).not.toThrow()
  })
})

describe('laneTaken', () => {
  // The target of the outcome the last fork recorded; null before any fork.
  it('reads the lane from the run history', () => {
    const h = [
      { stage: 'intake', outcome: 'pass' },
      { stage: 'holdout-write', outcome: 'pass' },
      { stage: 'triage', outcome: 'docs' },
      { stage: 'docs-update', outcome: 'pass' },
      { stage: 'holdout', outcome: 'fail' },
    ]
    expect(laneTaken(forked, h)).toBe('docs-update')
    expect(laneTaken(forked, h.slice(0, 2))).toBeNull()
    expect(laneTaken(forked, undefined)).toBeNull()
    expect(laneTaken(factory, [{ stage: 'intake', outcome: 'pass' }])).toBeNull()
  })
})
