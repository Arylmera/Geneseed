import { describe, it, expect } from 'vitest'
import { TIER, visible, requiredLevel, levelOfHref } from '../lib/tiers.js'
import { TABS } from '../lib/router.js'
import { LIBRARY_ORDER } from '../lib/sections.js'
import { NAV, FOOT } from '../components/Sidebar.jsx'
import { SECTIONS } from '../pages/Settings/index.jsx'

describe('view-level table', () => {
  it('every surface has a row', () => {
    const keys = [
      ...[...NAV, ...FOOT].map((n) => `page:${n.page}`),
      ...Object.entries(TABS).flatMap(([page, tabs]) => tabs.map((t) => `tab:${page}/${t}`)),
      ...LIBRARY_ORDER.map((k) => `section:library/${k}`),
      ...SECTIONS.map(([id]) => `section:settings/${id}`),
    ]
    const missing = keys.filter((k) => !(k in TIER))
    expect(missing).toEqual([])
  })

  it('levels as decided', () => {
    expect(visible('page:kits', 'essentials')).toBe(false)
    expect(visible('page:kits', 'standard')).toBe(true)
    expect(visible('page:loops', 'standard')).toBe(false)
    expect(visible('section:library/wiki', 'standard')).toBe(false)
    expect(visible('tab:installs/doctor', 'essentials')).toBe(true)
    expect(visible('section:settings/danger', 'standard')).toBe(false)
    expect(visible('section:settings/danger', 'power')).toBe(true)
  })

  it('an unknown key fails open', () => {
    expect(visible('page:nope', 'essentials')).toBe(true)
  })

  it('requiredLevel takes the highest level that applies', () => {
    expect(requiredLevel({ page: 'personal', tab: 'notebook' })).toBe('power')
    expect(requiredLevel({ page: 'library', section: 'config', item: 'x' })).toBe('power')
    expect(requiredLevel({ page: 'library' })).toBe('essentials')
    expect(requiredLevel({ page: 'laws', section: 'laws' })).toBe('standard')
  })

  it('levelOfHref resolves a hash first', () => {
    expect(levelOfHref('#/item/wiki/foo')).toBe('power')
    expect(levelOfHref('#/kits/x')).toBe('standard')
  })
})
