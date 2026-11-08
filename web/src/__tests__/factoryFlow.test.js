import { describe, it, expect } from 'vitest'
import { layoutFactory } from '../lib/factoryFlow.js'
// A copy of src/factories/bug-report-to-fix.json, so the geometry pinned here moves only when
// this file does: intake → loop:bugfix → pr-open → merge-gate → retro → $close, three stages
// failing to $stop, and a red merge-gate routing back to loop:bugfix (cycle `ci`, max 2).
import factory from './fixtures/bug-report-to-fix.json'

const BRICKS = [
  { name: 'intake', outcomes: ['pass', 'fail'] },
  { name: 'merge-gate', outcomes: ['pass', 'fail', 'none'], gate: 'human' },
]
const l = layoutFactory(factory, BRICKS)
const at = (id) => l.nodes.find((n) => n.id === id)
const nums = (path) => path.match(/-?\d+(\.\d+)?/g).map(Number)

describe('layoutFactory', () => {
  // Columns by longest path from `start`, the back edge left out: the shipped order, then the cap.
  it('lays the stages out left to right, $close last', () => {
    const xs = l.nodes.filter((n) => n.kind !== 'stop')
    expect(xs.map((n) => n.id)).toEqual([
      'intake',
      'loop:bugfix',
      'pr-open',
      'merge-gate',
      'retro',
      '$close',
    ])
    for (let i = 1; i < xs.length; i++) expect(xs[i].x).toBeGreaterThan(xs[i - 1].x + xs[i - 1].w)
    // One row: every block centred on the same midline.
    expect(new Set(xs.map((n) => n.y + n.h / 2)).size).toBe(1)
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
    expect(at('loop:bugfix').loop).toBe('bugfix')
    // The badge title comes from the brick's `gate: human`, as on the loop ring.
    expect(at('merge-gate').human).toBe('Human gate')
    expect(at('intake').human).toBeNull()
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

  // The arc leaves merge-gate's top and lands on loop:bugfix's top, and both of its control
  // points sit above every block, so the whole curve clears the row; the viewBox still holds it.
  it('draws the route back as an arc above the row', () => {
    const back = l.edges.find((e) => e.back)
    const [x0, y0, c1x, c1y, c2x, c2y, x1, y1] = nums(back.path)
    const mg = at('merge-gate')
    const lb = at('loop:bugfix')
    expect([x0, y0]).toEqual([mg.x + mg.w / 2, mg.y])
    expect([x1, y1]).toEqual([lb.x + lb.w / 2, lb.y])
    expect([c1x, c2x]).toEqual([x0, x1])
    const top = Math.min(...l.nodes.map((n) => n.y))
    expect(c1y).toBe(c2y)
    expect(c1y).toBeLessThan(top)
    expect(c1y).toBeGreaterThanOrEqual(0)
    expect(back.ly).toBeLessThan(top)
  })

  // $close caps the row on the midline; $stop sits under it, at the end of the rail every stop
  // edge drops into: down from the block's bottom, then right to the cap.
  it('caps the row with $close and the stop rail with $stop', () => {
    const close = at('$close')
    const stop = at('$stop')
    expect(stop.x).toBe(close.x)
    expect(stop.y).toBeGreaterThan(
      Math.max(...l.nodes.filter((n) => n !== stop).map((n) => n.y + n.h)),
    )
    const rail = stop.y + stop.h / 2
    for (const e of l.edges.filter((x) => x.kind === 'stop')) {
      const from = at(e.from)
      expect(e.path).toBe(`M${from.x + from.w / 2},${from.y + from.h} V${rail} H${stop.x}`)
    }
    expect(l.width).toBeGreaterThanOrEqual(close.x + close.w)
    expect(l.height).toBeGreaterThanOrEqual(stop.y + stop.h)
  })

  // A forward edge over a column is no straight line through the block between: an arc below.
  it('routes a forward edge that skips a column below the row', () => {
    const skip = layoutFactory({
      name: 's',
      start: 'a',
      stages: ['a', 'b', 'c'],
      edges: [
        { from: 'a', on: 'pass', to: 'b' },
        { from: 'a', on: 'none', to: 'c' },
        { from: 'b', on: 'pass', to: 'c' },
        { from: 'c', on: 'pass', to: '$close' },
      ],
    })
    const e = skip.edges.find((x) => x.from === 'a' && x.to === 'c')
    expect(e.kind).toBe('skip')
    const bottom = Math.max(...skip.nodes.map((n) => n.y + n.h))
    expect(nums(e.path)[3]).toBeGreaterThan(bottom)
    expect(skip.nodes.find((n) => n.id === '$stop')).toBeUndefined()
  })

  it('draws the triaged loop as a block naming its allowlist', () => {
    const t = layoutFactory({
      name: 't',
      start: 'triage',
      stages: ['triage', 'loop:$triaged'],
      loops: ['bugfix', 'feature'],
      edges: [
        { from: 'triage', on: 'pass', to: 'loop:$triaged' },
        { from: 'loop:$triaged', on: 'pass', to: '$close' },
      ],
    })
    const n = t.nodes.find((x) => x.id === 'loop:$triaged')
    expect([n.kind, n.allow, n.loop]).toEqual(['triaged', ['bugfix', 'feature'], null])
  })
})
