import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { relTime, promptPath, readiness, maxCount, editCount } from '../lib/format.js'

describe('relTime', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-06-13T00:00:00Z')) })
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
})
