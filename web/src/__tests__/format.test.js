import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { relTime, promptPath, readiness, maxCount, editCount, driftTotal } from '../lib/format.js'

describe('relTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-13T00:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())
  const now = () => Date.now() / 1000

  it('renders seconds, minutes, hours, and days at the right thresholds', () => {
    expect(relTime(now() - 5)).toBe('5s')
    expect(relTime(now() - 120)).toBe('2m')
    expect(relTime(now() - 3 * 3600)).toBe('3h')
    expect(relTime(now() - 2 * 86400)).toBe('2d')
  })
  it('clamps future timestamps to 0s', () => {
    expect(relTime(now() + 100)).toBe('0s')
  })
})

describe('promptPath', () => {
  it('collapses the POSIX home dir to ~', () => {
    expect(promptPath('/home/alice/proj')).toBe('~/proj')
    expect(promptPath('/Users/bob/code/x')).toBe('~/code/x')
  })
  it('collapses the Windows home dir to ~ and normalises separators', () => {
    expect(promptPath('C:\\Users\\bob\\proj')).toBe('~/proj')
  })
  it('falls back to ~ for empty/missing targets', () => {
    expect(promptPath('')).toBe('~')
    expect(promptPath(undefined)).toBe('~')
  })
})

describe('readiness', () => {
  it('is 0 without an overview', () => {
    expect(readiness(null)).toBe(0)
  })
  it('reaches 1 when deployed, clean, in sync, and complete', () => {
    const ov = { deployed: true, doctor: { ok: true }, diff: { missing: 0 } }
    const setup = { installed_fp: 'a', source_fp: 'a' }
    expect(readiness(ov, setup)).toBeCloseTo(1)
  })
  it('scores a deployed-but-drifting install partially (matches the dashboard fixture)', () => {
    const ov = { deployed: true, doctor: { ok: false, problems: ['x'] }, diff: { missing: 0 } }
    const setup = { installed_fp: 'a', source_fp: 'a' }
    // .40 deployed + .15 (<=2 problems) + .20 fp match + .15 nothing missing
    expect(readiness(ov, setup)).toBeCloseTo(0.9)
  })

  // The ring never reads healthier than the fleet verdict beside it. 'good', no verdict yet
  // (undefined) and a failed fleet fetch cap nothing, so the install's own score stands:
  // 1.0 for a perfect one, 0.9 for the dashboard fixture. 'warn' withholds the two shares a
  // warn fleet has not earned (version 0.20 + disk 0.15), capping at .40 + .25 = 0.65;
  // 'bad' leaves only "deployed", 0.40. A score already under the cap is not raised: not
  // deployed + doctor clean + fp match + nothing missing = .25 + .20 + .15 = 0.60 under 0.65.
  const sync = { installed_fp: 'a', source_fp: 'a' }
  const perfect = { deployed: true, doctor: { ok: true }, diff: { missing: 0 } }
  const fixture = { deployed: true, doctor: { ok: false, problems: ['x'] }, diff: { missing: 0 } }
  const undeployed = { deployed: false, doctor: { ok: true }, diff: { missing: 0 } }
  it.each([
    ['good', perfect, 1],
    ['good', fixture, 0.9],
    [undefined, perfect, 1],
    [undefined, fixture, 0.9],
    ['failed', perfect, 1],
    ['failed', fixture, 0.9],
    ['warn', perfect, 0.65],
    ['warn', fixture, 0.65],
    ['bad', perfect, 0.4],
    ['bad', fixture, 0.4],
    ['warn', undeployed, 0.6],
  ])('fleet tone %s caps the score at the verdict (row %#)', (tone, ov, want) => {
    expect(readiness(ov, sync, tone)).toBeCloseTo(want)
  })
})

describe('maxCount / editCount', () => {
  it('maxCount floors at 1 and ignores missing counts', () => {
    expect(maxCount({ agents: 5, skills: 3 })).toBe(5)
    expect(maxCount(null)).toBe(1)
    expect(maxCount({})).toBe(1)
  })
  it('editCount sums edited + added, defaulting to 0', () => {
    expect(editCount({ edited: 3, added: 1 })).toBe(4)
    expect(editCount({ edited: 2 })).toBe(2)
    expect(editCount(null)).toBe(0)
  })
  it('driftTotal adds missing to editCount, defaulting to 0', () => {
    expect(driftTotal({ edited: 3, added: 1, missing: 2 })).toBe(6)
    expect(driftTotal({ missing: 1 })).toBe(1)
    expect(driftTotal(null)).toBe(0)
  })
})
