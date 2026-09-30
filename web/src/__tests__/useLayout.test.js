import { describe, it, expect } from 'vitest'
import { resolveLayout, defaultLayoutFor } from '../hooks/useLayout.js'
import { FLAVOURS, resolveFlavour } from '../hooks/useFlavour.js'

describe('defaultLayoutFor', () => {
  it('pairs each surviving skin with the lens it was designed around', () => {
    // Atlas was drawn for the Journal; Operator keeps its dense HUD readout.
    expect(defaultLayoutFor('atlas')).toBe('journal')
    expect(defaultLayoutFor('operator')).toBe('operator')
    // Cultivar and Matrix share the genome grid. The Greenhouse lens is nobody's
    // default any more; it is still pickable, see resolveLayout below.
    expect(defaultLayoutFor('cultivar')).toBe('cultivar')
    expect(defaultLayoutFor('matrix')).toBe('cultivar')
  })

  // The original blank-tab bug: a flavour with no dispatch branch must fall back
  // to a real lens, not undefined.
  it('falls back to cultivar for an unknown flavour', () => {
    for (const f of ['neon', 'bogus', undefined]) expect(defaultLayoutFor(f)).toBe('cultivar')
  })
})

describe('resolveLayout', () => {
  it('honours an explicit valid layout over the flavour default', () => {
    expect(resolveLayout('atlas', 'operator')).toBe('operator')
    // The Greenhouse lens outlived its skin: any flavour can still pick it.
    expect(resolveLayout('matrix', 'greenhouse')).toBe('greenhouse')
    expect(resolveLayout('cultivar', 'journal')).toBe('journal')
  })

  it('uses the flavour default for auto, invalid, or absent layout', () => {
    expect(resolveLayout('atlas', 'auto')).toBe('journal')
    expect(resolveLayout('atlas', 'bogus')).toBe('journal')
    expect(resolveLayout('matrix', undefined)).toBe('cultivar')
  })

  it('never returns auto', () => {
    for (const f of FLAVOURS.map((x) => x.id)) expect(resolveLayout(f, 'auto')).not.toBe('auto')
  })
})

describe('flavours', () => {
  it('ships exactly the four kept skins', () => {
    expect(FLAVOURS.map((f) => f.id)).toEqual(['cultivar', 'operator', 'matrix', 'atlas'])
  })

  // Cut on 2026-09-30. A stored choice lands on the nearest survivor instead of
  // silently resetting: the organic Greenhouse on Atlas (same Journal lens), the
  // mono terminals Cobalt and Neon on Matrix, the rest on the Cultivar default.
  it('maps every retired skin to its survivor', () => {
    const expected = {
      greenhouse: 'atlas',
      cobalt: 'matrix',
      neon: 'matrix',
      heirloom: 'cultivar',
      aurora: 'cultivar',
      perspective: 'cultivar',
      sequencer: 'cultivar',
      cosmic: 'cultivar',
    }
    for (const [from, to] of Object.entries(expected)) expect(resolveFlavour(from)).toBe(to)
  })

  // The pre-slug single-letter ids, which still sit in old localStorage.
  it('maps the pre-rename letter ids through to a survivor', () => {
    expect(resolveFlavour('a')).toBe('cultivar')
    expect(resolveFlavour('b')).toBe('atlas')
    expect(resolveFlavour('c')).toBe('operator')
    expect(resolveFlavour('e')).toBe('matrix')
    expect(resolveFlavour('cb')).toBe('matrix')
  })

  it('keeps a live id and defaults an unknown one', () => {
    expect(resolveFlavour('operator')).toBe('operator')
    expect(resolveFlavour('nonsense')).toBe('cultivar')
    expect(resolveFlavour(null)).toBe('cultivar')
  })
})
