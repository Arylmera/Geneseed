import { describe, it, expect } from 'vitest'
import { SECTIONS, SECTION_ORDER, TYPE_TO_SECTION } from '../lib/sections.js'

describe('sections taxonomy', () => {
  it('SECTION_ORDER lists exactly the SECTIONS keys', () => {
    expect([...SECTION_ORDER].sort()).toEqual(Object.keys(SECTIONS).sort())
    expect(SECTION_ORDER).toHaveLength(7)
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
