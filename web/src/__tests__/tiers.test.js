import { describe, it, expect } from 'vitest'
import { TIER, visible, requiredLevel, levelOfHref } from '../lib/tiers.js'
import { TABS } from '../lib/router.js'
import { LIBRARY_ORDER } from '../lib/sections.js'
import { NAV, FOOT } from '../components/Sidebar.jsx'
import { SECTIONS } from '../pages/Settings/index.jsx'
import { PICKS } from '../pages/Installs/controls.jsx'

describe('view-level table', () => {
  it('every surface has a row', () => {
    const keys = [
      ...[...NAV, ...FOOT].map((n) => `page:${n.page}`),
      ...Object.entries(TABS).flatMap(([page, tabs]) => tabs.map((t) => `tab:${page}/${t}`)),
      ...LIBRARY_ORDER.map((k) => `section:library/${k}`),
      ...SECTIONS.map(([id]) => `section:settings/${id}`),
      ...PICKS.map((p) => `field:install/${p.name}`),
      'field:install/context-window',
    ]
    const missing = keys.filter((k) => !(k in TIER))
    expect(missing).toEqual([])
  })

  it('the table is exactly the decided map', () => {
    const E = 'essentials'
    const S = 'standard'
    const P = 'power'
    expect(TIER).toEqual({
      'page:overview': E,
      'page:laws': E,
      'page:library': E,
      'page:installs': E,
      'page:personal': E,
      'page:docs': E,
      'page:settings': E,
      'tab:personal/rules': E,
      'tab:personal/profile': E,
      // Memory is where a user looks for what the agent remembers; the default level is
      // Essentials, so a Standard row hid the only way to list the facts.
      'tab:personal/memory': E,
      'tab:installs/hosts': E,
      'tab:installs/doctor': E,
      'section:library/skills': E,
      'section:library/agents': E,
      'section:settings/machine': E,
      'section:settings/backup': E,
      'section:settings/server': E,
      'section:settings/about': E,
      'field:install/footprint': E,
      'field:install/posture': E,
      'page:kits': S,
      'page:activity': S,
      'tab:installs/profiles': S,
      'field:install/voice': S,
      'field:install/mode': S,
      'field:install/trust': S,
      'field:install/context-window': S,
      'page:models': P,
      'page:loops': P,
      'page:factories': P,
      'tab:loops/templates': P,
      'tab:loops/bricks': P,
      'tab:loops/active': P,
      'tab:factories/templates': P,
      'tab:factories/active': P,
      'tab:personal/notebook': P,
      'tab:installs/edits': P,
      'section:library/wiki': P,
      'section:library/config': P,
      'section:settings/danger': P,
    })
  })

  it('levels as decided', () => {
    expect(visible('page:kits', 'essentials')).toBe(false)
    expect(visible('page:kits', 'standard')).toBe(true)
    expect(visible('page:loops', 'standard')).toBe(false)
    expect(visible('section:library/wiki', 'standard')).toBe(false)
    expect(visible('tab:installs/doctor', 'essentials')).toBe(true)
    expect(visible('tab:personal/memory', 'essentials')).toBe(true)
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
    expect(requiredLevel({ page: 'laws', section: 'laws' })).toBe('essentials')
  })

  it('levelOfHref resolves a hash first', () => {
    expect(levelOfHref('#/item/wiki/foo')).toBe('power')
    expect(levelOfHref('#/kits/x')).toBe('standard')
  })
})
