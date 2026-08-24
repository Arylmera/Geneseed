import { describe, it, expect } from 'vitest'
import { resolveLayout, defaultLayoutFor } from '../hooks/useLayout.js'

describe('defaultLayoutFor', () => {
  it('splits the skins across the four layouts', () => {
    // The two ORGANIC skins take the Journal — Atlas was designed around it, and Greenhouse
    // is the organic skin that shipped before Atlas existed, so leaving it on the ring
    // dashboard would have made the new lens reachable only by picking it. Its old lens is
    // still in LAYOUTS, one click away in Settings; that is what this table being separate
    // from the flavour is for.
    expect(defaultLayoutFor('atlas')).toBe('journal')
    expect(defaultLayoutFor('greenhouse')).toBe('journal')
    expect(defaultLayoutFor('operator')).toBe('operator')
    // Cobalt inherits the ring dashboard Greenhouse vacated rather than following it to the
    // Journal: it is a mono terminal, and the whole point of the split is that the three
    // terminals do not present identically.
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
    // The journal is pickable from any skin — a lens is not a skin, and this is the row that
    // says so for the newest one.
    expect(resolveLayout('cultivar', 'journal')).toBe('journal')
  })

  it('uses the flavour default for auto, invalid, or absent layout', () => {
    expect(resolveLayout('greenhouse', 'auto')).toBe('journal')
    expect(resolveLayout('greenhouse', 'bogus')).toBe('journal')
    expect(resolveLayout('neon', undefined)).toBe('cultivar')
  })

  it('never returns auto', () => {
    for (const f of [
      'cultivar',
      'atlas',
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
