import { describe, it, expect, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  PAGES,
  TABS,
  VIEW_ALIAS,
  registerNavigationGuard,
  resolveRoute,
  useRoute,
} from '../lib/router.js'

// The resolver is the one place a hash becomes a page. Each row states what the hash must
// resolve to, written out: a routing change that moves a row has to move it here, with a
// reason. `section`/`item`/`tab` are omitted from a row where the route carries none.
//
// The console went from fourteen flat pages to five (Overview, Constitution, Library,
// Personal, Installs) plus Docs and Activity. EVERY OLD ADDRESS STILL LANDS: the block
// "retired pages" below is the old->new mapping, one row per name that used to be a page.
const TABLE = [
  // The overview, and everything the resolver does not recognise.
  ['', { page: 'overview' }],
  ['#/', { page: 'overview' }],
  ['#/overview', { page: 'overview' }],
  ['#/nonsense', { page: 'overview' }],
  // A hash is user input; the lookup tables are plain objects.
  ['#/constructor', { page: 'overview' }],
  // The five pages and the two footer pages resolve to themselves.
  ['#/laws', { page: 'laws' }],
  ['#/library', { page: 'library' }],
  // Kits: a list page whose item is the selected kit.
  ['#/kits', { page: 'kits' }],
  ['#/kits/spring-boot', { page: 'kits', item: 'spring-boot' }],
  ['#/loops', { page: 'loops', tab: 'templates' }],
  ['#/loops/bricks', { page: 'loops', tab: 'bricks' }],
  ['#/loops/active', { page: 'loops', tab: 'active' }],
  // Loops' Templates tab carries the selected template.
  ['#/loops/templates/bugfix', { page: 'loops', tab: 'templates', item: 'bugfix' }],
  ['#/docs', { page: 'docs', item: '' }],
  ['#/activity', { page: 'activity' }],
  // Tabbed pages: a bare page opens its first tab; an unknown tab falls to the first.
  ['#/personal', { page: 'personal', tab: 'rules' }],
  ['#/personal/profile', { page: 'personal', tab: 'profile' }],
  ['#/personal/bogus', { page: 'personal', tab: 'rules' }],
  ['#/installs', { page: 'installs', tab: 'hosts' }],
  ['#/installs/kits', { page: 'installs', tab: 'kits' }],
  ['#/installs/edits', { page: 'installs', tab: 'edits' }],
  ['#/installs/server', { page: 'installs', tab: 'server' }],
  // Personal's Memory and Notebook tabs carry an entry of their own, URI-decoded.
  ['#/personal/memory/a%20b', { page: 'personal', tab: 'memory', item: 'a b' }],
  // ...but an item under an unknown tab is dropped with the tab, not attached to rules.
  ['#/personal/bogus/x', { page: 'personal', tab: 'rules' }],
  // Retired pages -> where they live now.
  ['#/dashboard', { page: 'overview' }],
  ['#/constitution', { page: 'laws' }],
  ['#/skills', { page: 'library', section: 'skills' }],
  ['#/agents', { page: 'library', section: 'agents' }],
  ['#/rules', { page: 'personal', tab: 'rules' }],
  ['#/profile', { page: 'personal', tab: 'profile' }],
  ['#/harness', { page: 'installs', tab: 'hosts' }],
  ['#/harnesses', { page: 'installs', tab: 'hosts' }],
  ['#/themes', { page: 'installs', tab: 'hosts' }],
  ['#/diff', { page: 'installs', tab: 'edits' }],
  ['#/doctor', { page: 'installs', tab: 'doctor' }],
  ['#/settings', { page: 'installs', tab: 'server' }],
  ['#/about', { page: 'installs', tab: 'server' }],
  // Sections: the constitution has its own page; every other section is a Library kind.
  ['#/section/laws', { page: 'laws', section: 'laws' }],
  ['#/section/skills', { page: 'library', section: 'skills' }],
  ['#/section/agents', { page: 'library', section: 'agents' }],
  ['#/section/memory', { page: 'library', section: 'memory' }],
  ['#/section', { page: 'library' }],
  // Setup files are a kind of their own now; they no longer fold into the wiki.
  ['#/section/config', { page: 'library', section: 'config' }],
  // Items: the singular type names the section, and the name is URI-decoded.
  ['#/item/law/IV', { page: 'laws', section: 'laws', item: 'IV' }],
  ['#/item/law/process.5', { page: 'laws', section: 'laws', item: 'process.5' }],
  ['#/item/skill/tdd', { page: 'library', section: 'skills', item: 'tdd' }],
  ['#/item/agent/advocate', { page: 'library', section: 'agents', item: 'advocate' }],
  ['#/item/memory/a%20b', { page: 'library', section: 'memory', item: 'a b' }],
  ['#/item/config/geneseed.jsonc', { page: 'library', section: 'config', item: 'geneseed.jsonc' }],
  ['#/item/wiki/x%2Fy', { page: 'library', section: 'wiki', item: 'x/y' }],
  // An unknown type still lands on Library (which falls back to its first kind).
  ['#/item/bogus/z', { page: 'library', section: 'bogus', item: 'z' }],
  ['#/item/constructor/z', { page: 'library', section: 'constructor', item: 'z' }],
  // Docs carries a sub-page path in `item`, slashes and all; Activity a session id.
  ['#/docs/cli/build', { page: 'docs', item: 'cli/build' }],
  ['#/docs/a%20b', { page: 'docs', item: 'a b' }],
  ['#/activity/s%201', { page: 'activity', item: 's 1' }],
  // A malformed escape is typed input, not a crash: the raw text is the item.
  ['#/item/skill/%E0%A4%A', { page: 'library', section: 'skills', item: '%E0%A4%A' }],
]

describe('resolveRoute', () => {
  it.each(TABLE)('%j -> %j', (hash, expected) => {
    const r = resolveRoute(hash)
    // Drop undefined keys so a row states only what the route carries.
    expect(Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined))).toEqual(
      expected,
    )
  })

  it('always lands on a page in PAGES, and a tabbed page on one of its tabs', () => {
    for (const [hash] of TABLE) {
      const r = resolveRoute(hash)
      expect(Object.keys(PAGES)).toContain(r.page)
      if (TABS[r.page]) expect(TABS[r.page]).toContain(r.tab)
    }
  })

  it('every alias targets a real page and, where it names one, a real tab', () => {
    for (const [page, tab] of Object.values(VIEW_ALIAS)) {
      expect(Object.keys(PAGES)).toContain(page)
      if (tab) expect(TABS[page]).toContain(tab)
    }
  })
})

describe('PAGES', () => {
  // The breadcrumb and the sidebar print these; the laws page reads "Constitution" while
  // its route stays #/laws.
  it('names the nine pages', () => {
    expect(PAGES).toEqual({
      overview: 'Overview',
      laws: 'Constitution',
      library: 'Library',
      kits: 'Kits',
      loops: 'Loops',
      personal: 'Personal',
      installs: 'Installs',
      docs: 'Docs',
      activity: 'Activity',
    })
  })
})

// The navigation guard seam: a guard returning false refuses an in-app hash change, and the
// address bar is put back. The guard set is module-level, so every test unregisters.
describe('navigation guards', () => {
  const navigate = (hash) =>
    act(() => {
      window.location.hash = hash
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
  let unregister = () => {}
  afterEach(() => {
    unregister()
    unregister = () => {}
    window.location.hash = '#/'
  })

  it('with no guard, a hash change moves the route', () => {
    window.location.hash = '#/laws'
    const { result } = renderHook(() => useRoute())
    navigate('#/kits')
    expect(result.current).toEqual({ page: 'kits' })
  })

  it('a guard returning false keeps the route and restores the hash', () => {
    window.location.hash = '#/laws'
    const seen = []
    unregister = registerNavigationGuard((nav) => {
      seen.push(nav)
      return false
    })
    const { result } = renderHook(() => useRoute())
    navigate('#/kits')
    expect(result.current).toEqual({ page: 'laws' })
    expect(window.location.hash).toBe('#/laws')
    expect(seen).toEqual([{ from: '#/laws', to: '#/kits' }])
  })

  // `from` stays the last ACCEPTED hash across refusals, and an event whose hash did not
  // move (an echo, or the restore itself) never reaches the guard.
  it('a second refusal still sees the accepted hash; an unchanged hash is not asked', () => {
    window.location.hash = '#/laws'
    const seen = []
    unregister = registerNavigationGuard((nav) => {
      seen.push(nav)
      return false
    })
    renderHook(() => useRoute())
    navigate('#/kits')
    navigate('#/docs')
    act(() => window.dispatchEvent(new HashChangeEvent('hashchange')))
    expect(seen).toEqual([
      { from: '#/laws', to: '#/kits' },
      { from: '#/laws', to: '#/docs' },
    ])
  })

  it('after unregister, navigation proceeds', () => {
    window.location.hash = '#/laws'
    const off = registerNavigationGuard(() => false)
    const { result } = renderHook(() => useRoute())
    off()
    navigate('#/kits')
    expect(result.current).toEqual({ page: 'kits' })
    expect(window.location.hash).toBe('#/kits')
  })
})
