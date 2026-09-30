import { describe, it, expect } from 'vitest'
import { LAYOUTS, resolveLayout } from '../hooks/useLayout.js'
import { FLAVOURS, resolveFlavour } from '../hooks/useFlavour.js'

describe('resolveLayout', () => {
  it('offers the new Overview first, then the four older dashboards', () => {
    expect(LAYOUTS.map((l) => l.id)).toEqual([
      'overview',
      'cultivar',
      'greenhouse',
      'operator',
      'journal',
    ])
  })

  it('keeps an explicit choice, whatever the skin', () => {
    // The view is independent of the flavour: Operator's HUD under the Atlas skin is fine.
    for (const id of ['overview', 'cultivar', 'greenhouse', 'operator', 'journal'])
      expect(resolveLayout(id)).toBe(id)
  })

  // 'auto' used to mean "the lens this skin was drawn around", and useLocalStorage persists
  // the default on first render, so nearly every browser holds a stored 'auto'. The new
  // Overview is the console for everyone, so a stored 'auto' reads as the Overview; so do
  // an unknown id and nothing at all.
  it('reads auto, an unknown id and an empty store as the Overview', () => {
    for (const v of ['auto', 'bogus', null, undefined, ''])
      expect(resolveLayout(v)).toBe('overview')
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
