import { describe, it, expect } from 'vitest'
import { PAGES, VIEW_ALIAS, resolveRoute } from '../lib/router.js'

// The resolver is the one place a hash becomes a page. Each row states what the hash
// must resolve to, written out: a routing change that moves a row has to move it here,
// with a reason. `section`/`item` are omitted from a row where the route carries none.
const TABLE = [
  // The dashboard, and everything the resolver does not recognise.
  ['', { page: 'dashboard' }],
  ['#/', { page: 'dashboard' }],
  ['#/dashboard', { page: 'dashboard' }],
  ['#/nonsense', { page: 'dashboard' }],
  // A hash is user input; the lookup tables are plain objects.
  ['#/constructor', { page: 'dashboard' }],
  // Flat pages resolve to themselves.
  ['#/laws', { page: 'laws' }],
  ['#/skills', { page: 'skills' }],
  ['#/rules', { page: 'rules' }],
  ['#/profile', { page: 'profile' }],
  ['#/library', { page: 'library' }],
  ['#/activity', { page: 'activity' }],
  ['#/diff', { page: 'diff' }],
  ['#/doctor', { page: 'doctor' }],
  ['#/harness', { page: 'harness' }],
  ['#/settings', { page: 'settings' }],
  // `#/agents` is the Library view pinned to the agents chip.
  ['#/agents', { page: 'agents', section: 'agents' }],
  // VIEW_ALIAS: retired names land on the page that absorbed them.
  ['#/themes', { page: 'harness' }],
  ['#/harnesses', { page: 'harness' }],
  ['#/about', { page: 'settings' }],
  // Sections fold into the page that owns them: laws, skills and agents have their own
  // pages; every other section is a Library chip.
  ['#/section/laws', { page: 'laws', section: 'laws' }],
  ['#/section/skills', { page: 'skills', section: 'skills' }],
  ['#/section/agents', { page: 'agents', section: 'agents' }],
  ['#/section/memory', { page: 'library', section: 'memory' }],
  ['#/section', { page: 'library' }],
  // SECTION_ALIAS: config has no chip of its own; it folds into the wiki chip.
  ['#/section/config', { page: 'library', section: 'wiki' }],
  // Items: the singular type names the section, and the name is URI-decoded.
  ['#/item/law/IV', { page: 'laws', section: 'laws', item: 'IV' }],
  ['#/item/skill/tdd', { page: 'skills', section: 'skills', item: 'tdd' }],
  ['#/item/agent/advocate', { page: 'agents', section: 'agents', item: 'advocate' }],
  ['#/item/memory/a%20b', { page: 'library', section: 'memory', item: 'a b' }],
  ['#/item/config/geneseed.jsonc', { page: 'library', section: 'wiki', item: 'geneseed.jsonc' }],
  ['#/item/wiki/x%2Fy', { page: 'library', section: 'wiki', item: 'x/y' }],
  // An unknown type still lands on Library (which falls back to its first chip).
  ['#/item/bogus/z', { page: 'library', section: 'bogus', item: 'z' }],
  ['#/item/constructor/z', { page: 'library', section: 'constructor', item: 'z' }],
  // Docs carries a sub-page path in `item`, slashes and all; Activity a session id.
  ['#/docs', { page: 'docs', item: '' }],
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

  it('always lands on a page in PAGES', () => {
    for (const [hash] of TABLE) expect(Object.keys(PAGES)).toContain(resolveRoute(hash).page)
  })

  it('every alias targets a real page', () => {
    for (const target of Object.values(VIEW_ALIAS)) expect(Object.keys(PAGES)).toContain(target)
  })
})

describe('PAGES tab flags', () => {
  // The topbar prompt prints `--tab=<flag>`. The dashboard is the only page whose flag
  // differs from its name: the prompt calls it the overview.
  it('names every page by itself, except the dashboard', () => {
    expect(PAGES).toEqual({
      dashboard: 'overview',
      laws: 'laws',
      rules: 'rules',
      profile: 'profile',
      skills: 'skills',
      agents: 'agents',
      library: 'library',
      docs: 'docs',
      activity: 'activity',
      diff: 'diff',
      doctor: 'doctor',
      harness: 'harness',
      settings: 'settings',
    })
  })
})
