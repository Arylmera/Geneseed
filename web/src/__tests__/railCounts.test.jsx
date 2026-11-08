import React from 'react'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// THE INVARIANT: a rail badge equals what its page lists. One fixture per page, written out:
// two installs that overlap (`both` is on each, and listed once), and one doctrine rule the install
// excludes, which the page still lists with its switch. The names on the page are the claim: the
// badge must equal the size of that set, and the set must be the one written here. The server's
// half, that `counts` is the size of these same lists, is tests/unit/web_counts.test.mjs.

vi.mock('../api/index.js', () => ({
  api: {
    catalog: vi.fn(),
    item: vi.fn(),
    usage: vi.fn(),
    overview: vi.fn(),
    rules: vi.fn(),
    loadout: vi.fn(async () => null),
  },
}))
vi.mock('../lib/router.js', () => ({ go: vi.fn() }))

import { api } from '../api/index.js'
import Sidebar from '../components/Sidebar.jsx'
import Library from '../pages/Library.jsx'
import Laws from '../pages/Laws.jsx'
import { LIBRARY_ORDER } from '../lib/sections.js'

const K1 = 'claude:global:/c'
const K2 = 'bob:global:/b'
const row = (name, installs = [K1, K2]) => ({ name, title: name, desc: '', installs })
const LISTS = {
  skills: [row('both-skill'), row('only-claude', [K1]), row('only-bob', [K2])],
  agents: [row('both-agent')],
  memory: [row('fact-a', [K1]), row('fact-b', [K2])],
  notebook: [row('note-a', [K1])],
  wiki: [row('vault:a.md', [K1]), row('vault:b.md', [K1]), row('vault:c.md', [K1])],
  config: [row('context.json')],
}
const LAWS = [
  { name: 'ont:telos', title: 'Telos', tier: 'ontology' },
  { name: 'I', title: 'Secrets', tier: 'invariant' },
  { name: 'II', title: 'One act', tier: 'invariant' },
  ...[1, 2, 3].map((n) => ({
    name: `craft.${n}`,
    title: `Rule ${n}`,
    tier: 'doctrine',
    pack: 'craft',
    packActive: true,
    active: n !== 3, // excluded here, and still a row
  })),
]
// What /api/overview answers for these lists: each figure written out by hand.
const COUNTS = {
  skills: 3,
  agents: 1,
  memory: 2,
  notebook: 1,
  wiki: 3,
  config: 1,
  laws: 2,
  ontology: 1,
  doctrines: { active: 1, total: 1, rules: 3 },
  loops: 0,
}
const overview = { counts: COUNTS, theme: 'neutral' }
const badge = (label) => {
  render(<Sidebar route={{ page: 'overview' }} overview={overview} installs={[]} />)
  const n = screen.getByText(label).closest('a').querySelector('.sb-count')?.textContent
  cleanup()
  return n
}

beforeEach(() => {
  vi.clearAllMocks()
  api.catalog.mockImplementation((section) =>
    Promise.resolve(
      section === 'laws'
        ? { section, items: LAWS }
        : { section, items: LISTS[section] || [], sharedInstalls: [] },
    ),
  )
  api.item.mockResolvedValue({ body: 'text' })
  api.usage.mockResolvedValue(null)
  api.rules.mockResolvedValue({ exists: true, stats: { rules: 0, tokens: 0 }, rules: [] })
})

describe('a rail badge equals what its page lists', () => {
  it.each(LIBRARY_ORDER)('Library kind %s: the rail, the list head and the rows', async (kind) => {
    const { container } = render(<Library section={kind} overview={overview} />)
    await waitFor(() => expect(container.querySelector('.lib-row')).toBeTruthy())
    // The pinned primary agent (Agents only) is no catalogue entry, so no badge counts it.
    const rows = [...container.querySelectorAll('.lib-row:not([data-pinned])')].map(
      (r) => r.dataset.title,
    )
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.sort()).toEqual(LISTS[kind].map((r) => r.title).sort())
    expect(container.querySelector('.lib-list-head .mono').textContent).toBe(String(rows.length))
    // Every kind's rail figure, the ones not on screen included, is its list's size.
    const rail = [...container.querySelectorAll('.kind-list > a')].map((a) => a.textContent)
    expect(rail).toEqual(['Skills3', 'Agents1', 'Wiki3', 'Setup files1'].map((x) => x))
  })

  it('Library: the Sidebar badge sums the kinds the page lists', () => {
    const listed = LIBRARY_ORDER.reduce((n, k) => n + LISTS[k].length, 0)
    expect(listed).toBe(8)
    expect(badge('Library')).toBe('8')
  })

  it('Constitution: the Sidebar badge, the All tab and the listed rule rows', async () => {
    const { container } = render(<Laws overview={{ install: null }} />)
    await waitFor(() => expect(container.querySelector('.law-toolbar')).toBeTruthy())
    const all = screen.getByRole('button', { name: /^All/ }).textContent
    const rules = LAWS.filter((l) => l.tier !== 'ontology')
    expect(rules.length).toBe(5)
    expect(all).toBe('All 5')
    cleanup()
    expect(badge('Constitution')).toBe('5')
  })

  it('Constitution: Doctrines reads one figure on the strip and the tab', async () => {
    const { container } = render(<Laws overview={{ install: null }} />)
    await waitFor(() => expect(container.querySelector('.tier-strip')).toBeTruthy())
    const cell = [...container.querySelectorAll('.tier')].find((t) =>
      t.textContent.includes('Doctrines'),
    )
    expect(cell.querySelector('.tier-n').textContent).toBe('3')
    expect(screen.getByRole('button', { name: /^Doctrines 3/ })).toBeTruthy()
  })
})
