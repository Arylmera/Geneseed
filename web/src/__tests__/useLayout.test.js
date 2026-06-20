import { describe, it, expect } from 'vitest'
import { resolveLayout, defaultLayoutFor } from '../hooks/useLayout.js'

describe('defaultLayoutFor', () => {
  it('splits the mono terminals across the three layouts', () => {
    expect(defaultLayoutFor('greenhouse')).toBe('greenhouse')
    expect(defaultLayoutFor('operator')).toBe('operator')
    expect(defaultLayoutFor('cobalt')).toBe('greenhouse')
    expect(defaultLayoutFor('matrix')).toBe('cultivar')
  })

  // The original blank-tab bug: flavours with no dispatch branch (neon, perspective)
  // must fall back to a real lens, not undefined. Matrix now rides this fallback too.
  it('falls back to cultivar for every other flavour', () => {
    for (const f of [
      'cultivar',
      'heirloom',
      'matrix',
      'aurora',
      'perspective',
      'sequencer',
      'cosmic',
      'neon',
      undefined,
    ])
      expect(defaultLayoutFor(f)).toBe('cultivar')
  })
})

describe('resolveLayout', () => {
  it('honours an explicit valid layout over the flavour default', () => {
    expect(resolveLayout('greenhouse', 'operator')).toBe('operator')
    expect(resolveLayout('neon', 'greenhouse')).toBe('greenhouse')
  })

  it('uses the flavour default for auto, invalid, or absent layout', () => {
    expect(resolveLayout('greenhouse', 'auto')).toBe('greenhouse')
    expect(resolveLayout('greenhouse', 'bogus')).toBe('greenhouse')
    expect(resolveLayout('neon', undefined)).toBe('cultivar')
  })

  it('never returns auto', () => {
    for (const f of [
      'cultivar',
      'greenhouse',
      'operator',
      'matrix',
      'cobalt',
      'neon',
      'perspective',
    ])
      expect(resolveLayout(f, 'auto')).not.toBe('auto')
  })
})
