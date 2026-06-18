import { describe, it, expect } from 'vitest'
import { SECTIONS, SECTION_ORDER, TYPE_TO_SECTION } from '../lib/sections.js'

describe('sections taxonomy', () => {
  it('SECTION_ORDER is the SECTIONS keys minus laws and skills (each has its own tab)', () => {
    // Laws and Skills each get a dedicated top-level tab (#/laws, #/skills) with a
    // purpose-built ledger, not the generic Library chip-bar. SECTIONS.laws/.skills
    // still exist so the `law`/`skill` item types resolve, but both are deliberately
    // absent from SECTION_ORDER. Every other key is present.
    expect([...SECTION_ORDER].sort()).toEqual(
      Object.keys(SECTIONS)
        .filter((k) => k !== 'laws' && k !== 'skills')
        .sort(),
    )
    expect(SECTION_ORDER).not.toContain('laws')
    expect(SECTION_ORDER).not.toContain('skills')
    expect(SECTION_ORDER).toHaveLength(5)
  })

  it('every section carries a full set of display metadata', () => {
    for (const key of SECTION_ORDER) {
      const m = SECTIONS[key]
      expect(m.label).toBeTruthy()
      expect(m.type).toBeTruthy()
      expect(m.desc).toBeTruthy()
      expect(m.icon).toBeTruthy()
    }
  })

  it('TYPE_TO_SECTION round-trips every singular type back to its section', () => {
    for (const key of SECTION_ORDER) {
      expect(TYPE_TO_SECTION[SECTIONS[key].type]).toBe(key)
    }
    expect(TYPE_TO_SECTION.agent).toBe('agents')
    expect(TYPE_TO_SECTION.law).toBe('laws')
  })
})
