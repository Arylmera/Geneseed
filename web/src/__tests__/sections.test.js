import { describe, it, expect } from 'vitest'
import { SECTIONS, SECTION_ORDER, LIBRARY_ORDER, TYPE_TO_SECTION } from '../lib/sections.js'

describe('sections taxonomy', () => {
  it('SECTION_ORDER is the SECTIONS keys minus laws and skills', () => {
    // The dashboard strands, genome bars and search index walk SECTION_ORDER; laws and
    // skills each have a purpose-built view of their own and would double-count there.
    expect(SECTION_ORDER).toEqual(['agents', 'memory', 'notebook', 'wiki', 'config'])
  })

  it('LIBRARY_ORDER is every section except the constitution, skills first', () => {
    // The Library's kinds column. Skills and Agents stopped being pages of their own and
    // became its first two kinds; setup files (config) are a kind of their own rather than
    // folding into the wiki. The constitution keeps its own page.
    expect(LIBRARY_ORDER).toEqual(['skills', 'agents', 'memory', 'notebook', 'wiki', 'config'])
    expect(LIBRARY_ORDER).not.toContain('laws')
  })

  it('every section carries a full set of display metadata', () => {
    for (const key of Object.keys(SECTIONS)) {
      const m = SECTIONS[key]
      expect(m.label).toBeTruthy()
      expect(m.type).toBeTruthy()
      expect(m.desc).toBeTruthy()
      expect(m.icon).toBeTruthy()
    }
  })

  it('TYPE_TO_SECTION round-trips every singular type back to its section', () => {
    for (const key of Object.keys(SECTIONS)) expect(TYPE_TO_SECTION[SECTIONS[key].type]).toBe(key)
    expect(TYPE_TO_SECTION.agent).toBe('agents')
    expect(TYPE_TO_SECTION.law).toBe('laws')
  })
})
