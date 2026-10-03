import { describe, it, expect } from 'vitest'
import { PAGES, TABS, VIEW_ALIAS, resolveRoute } from '../lib/router.js'

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
  ['#/loops', { page: 'loops', tab: 'templates' }],
  ['#/loops/bricks', { page: 'loops', tab: 'bricks' }],
  // Loops' Templates tab carries the selected template.
  ['#/loops/templates/bugfix', { page: 'loops', tab: 'templates', item: 'bugfix' }],
  ['#/docs', { page: 'docs', item: '' }],
  ['#/activity', { page: 'activity' }],
  // Tabbed pages: a bare page opens its first tab; an unknown tab falls to the first.
  ['#/personal', { page: 'personal', tab: 'rules' }],
  ['#/personal/profile', { page: 'personal', tab: 'profile' }],
  ['#/personal/bogus', { page: 'personal', tab: 'rules' }],
  ['#/installs', { page: 'installs', tab: 'hosts' }],
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
  // its route stays #/laws (doctor reads web/src/pages/Laws.jsx by that name).
  it('names the eight pages', () => {
    expect(PAGES).toEqual({
      overview: 'Overview',
      laws: 'Constitution',
      library: 'Library',
      loops: 'Loops',
      personal: 'Personal',
      installs: 'Installs',
      docs: 'Docs',
      activity: 'Activity',
    })
  })
})
