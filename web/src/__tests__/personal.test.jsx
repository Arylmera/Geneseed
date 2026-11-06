import React from 'react'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Personal, with the real Rules editor under it: counts that come from the folder the pane lists,
// and one filled action per view.

vi.mock('../api/index.js', () => ({
  api: {
    rules: vi.fn(),
    rulesMutate: vi.fn(),
    rulesPromote: vi.fn(),
    profile: vi.fn(),
    profileSave: vi.fn(),
    catalog: vi.fn(),
    item: vi.fn(),
    memoryDelete: vi.fn(),
  },
}))

import Personal from '../pages/Personal.jsx'
import { api } from '../api/index.js'
import { ConfirmContext } from '../hooks/useConfirm.jsx'

const TRIAL = {
  id: 1,
  title: 'Prefer tabs',
  scope: 'user',
  source: '',
  trial_until: '2026-12-01',
  status: 'trial',
  overdue: false,
  body: 'Always use tabs.',
  tokens: 12,
}
const rulesWith = (stats) => ({
  exists: true,
  fingerprint: 'f1',
  warnings: [],
  stats: { rules: 2, lines: 20, tokens: 300, ...stats },
  rules: [TRIAL],
})
const entries = (n) => Array.from({ length: n }, (_, i) => ({ name: `fact-${i}`, title: '' }))

let memoryItems
beforeEach(() => {
  vi.clearAllMocks()
  memoryItems = entries(3)
  api.rules.mockImplementation(() => Promise.resolve(rulesWith({})))
  api.profile.mockImplementation(() =>
    Promise.resolve({ exists: true, seeded: false, fingerprint: 'p1', text: '# Me' }),
  )
  api.catalog.mockImplementation((section) =>
    Promise.resolve({
      section,
      items: section === 'memory' ? memoryItems : [{ name: 'plan' }],
    }),
  )
  api.item.mockImplementation((type, name) =>
    Promise.resolve({ name, title: '', desc: '', body: '', links: [] }),
  )
})

// `setup.facts` disagrees with the catalog on purpose: the counts must come from the catalog.
const SETUP = { facts: 5 }
const badgeOf = (tab) =>
  screen.getByRole('link', { name: new RegExp(`^${tab}`) }).querySelector('.tab-badge')

describe('Personal', () => {
  const TWO = {
    installs: [
      { id: 'oc', host: 'opencode', scope: 'global', path: '/oc', state: 'active', shared: true },
      { id: 'cl', host: 'claude', scope: 'global', path: '/cl', state: 'active', shared: true },
    ],
  }

  // The shared scope is said once, in the page header, and only when an install reads the tier.
  it('states the shared scope once, in the header', async () => {
    api.installs = vi.fn(async () => TWO)
    try {
      render(<Personal tab="rules" dataRev={0} />)
      await screen.findByText(/Global installs share one copy of the rules, profile and memory/)
      await screen.findByText('Prefer tabs')
      expect(document.body.textContent.match(/share one copy/g)).toHaveLength(1)
    } finally {
      delete api.installs
    }
  })

  it('says nothing of sharing when no install reads the tier', async () => {
    render(<Personal tab="rules" dataRev={0} />)
    await screen.findByText('Prefer tabs')
    expect(screen.queryByText(/share one copy/)).toBeNull()
  })

  // The rule count has one home, the head of its file's list: no tab badge, no summary card.
  it('prints the rule count once', async () => {
    render(<Personal tab="rules" dataRev={0} />)
    await screen.findByText('Prefer tabs')
    expect(badgeOf('Rules')).toBeNull()
    expect(document.body.textContent.match(/1 rule\b/g)).toHaveLength(1)
    expect(screen.queryByRole('region', { name: /knows about you/ })).toBeNull()
  })

  it('badges the Memory tab with the catalog entries', async () => {
    render(<Personal tab="rules" setup={SETUP} dataRev={0} />)
    await waitFor(() => expect(badgeOf('Memory')?.textContent).toBe('3'))
  })

  // A promote deletes the fact it turns into a rule (`delete_memory`): the Memory count must
  // follow, not keep the pre-promote listing.
  it('a promote from the Memory pane refreshes the Memory badge', async () => {
    api.rulesPromote.mockImplementation(() => {
      memoryItems = memoryItems.filter((i) => i.name !== 'fact-0')
      return Promise.resolve({ ok: true })
    })
    const view = render(
      <ConfirmContext.Provider value={async () => true}>
        <Personal tab="memory" item="fact-0" dataRev={0} />
      </ConfirmContext.Provider>,
    )
    await waitFor(() => expect(badgeOf('Memory')?.textContent).toBe('3'))
    fireEvent.click(await screen.findByText('Promote to rule'))
    await waitFor(() => expect(api.rulesPromote).toHaveBeenCalledTimes(1))
    view.rerender(
      <ConfirmContext.Provider value={async () => true}>
        <Personal tab="rules" dataRev={0} />
      </ConfirmContext.Provider>,
    )
    await waitFor(() => expect(badgeOf('Memory')?.textContent).toBe('2'))
  })

  it('an empty memory folder shows "No facts yet" instead of the reader', async () => {
    memoryItems = []
    const { container } = render(<Personal tab="memory" setup={SETUP} dataRev={0} />)
    expect(await screen.findByText('No facts yet')).toBeTruthy()
    expect(screen.getByText(/remember that…/)).toBeTruthy()
    expect(container.querySelector('.library')).toBeNull()
  })

  // First run: the empty state explains the store and links out, with no filled button.
  it('the first-run memory state links to the docs and the rule skill', async () => {
    memoryItems = []
    const { container } = render(<Personal tab="memory" dataRev={0} />)
    await screen.findByText('No facts yet')
    expect(screen.getByRole('link', { name: 'How memory works' }).getAttribute('href')).toBe(
      '#/docs/memory',
    )
    expect(screen.getByRole('link', { name: 'The rule skill' }).getAttribute('href')).toBe(
      '#/item/skill/rule',
    )
    expect(screen.getByText('One fact per file, filed under a topic.')).toBeTruthy()
    expect(
      screen.getByText('Stale facts move to Archived; nothing is deleted without you.'),
    ).toBeTruthy()
    expect(screen.getByText('The store stays on this machine and out of git.')).toBeTruthy()
    const filled = [...container.querySelectorAll('button.btn, a.btn')].filter(
      (b) => !b.classList.contains('ghost'),
    )
    expect(filled).toEqual([])
  })

  // The topics come from the generated MEMORY.md map (js/hosts/memory-files.mjs writeMap).
  const mapWith = (body) =>
    api.item.mockImplementation((section, name) =>
      Promise.resolve(
        section === 'memory' && name === 'MEMORY'
          ? { title: 'MEMORY', desc: '', body, links: [] }
          : { name, title: '', desc: '', body: '', links: [] },
      ),
    )

  it('lists the topics of the memory map above the reader', async () => {
    mapWith(
      [
        '# Memory',
        '',
        '_Generated by geneseed; one line per topic._',
        '',
        '- [release](topics/release.md) — 2 facts',
        '- [web](topics/web.md) — 1 fact',
      ].join('\n'),
    )
    render(<Personal tab="memory" dataRev={0} />)
    const topics = await screen.findByRole('region', { name: 'Topics' })
    const rows = within(topics).getAllByRole('listitem')
    expect(rows.map((li) => li.textContent)).toEqual(['release2 facts', 'web1 fact'])
    expect(within(topics).getByText('2 topics')).toBeTruthy()
  })

  it('leaves the topics of the shared store untagged: the header says shared', async () => {
    api.item.mockImplementation(() =>
      Promise.resolve({
        body: '- [release](topics/release.md) — 2 facts',
        install: 'claude:global:/cl',
        shared: true,
        links: [],
      }),
    )
    render(<Personal tab="memory" dataRev={0} />)
    const topics = await screen.findByRole('region', { name: 'Topics' })
    expect(topics.textContent).not.toMatch(/claude|shared/)
  })

  // A forget rewrites the map server-side; the panel must not keep the old count.
  it('a forget in the Memory pane refreshes the topic counts', async () => {
    let n = 3
    api.item.mockImplementation((section, name) =>
      Promise.resolve(
        name === 'MEMORY'
          ? { body: `- [release](topics/release.md) — ${n} facts`, links: [] }
          : { name, title: '', desc: '', body: '', links: [] },
      ),
    )
    api.memoryDelete.mockImplementation(() => {
      memoryItems = memoryItems.filter((i) => i.name !== 'fact-0')
      n = 2
      return Promise.resolve({ ok: true })
    })
    render(
      <ConfirmContext.Provider value={async () => true}>
        <Personal tab="memory" item="fact-0" dataRev={0} />
      </ConfirmContext.Provider>,
    )
    const topics = await screen.findByRole('region', { name: 'Topics' })
    await waitFor(() => expect(within(topics).getByText('3 facts')).toBeTruthy())
    fireEvent.click(await screen.findByText('Forget this fact'))
    await waitFor(() => expect(api.memoryDelete).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Topics' })).getByText('2 facts'),
      ).toBeTruthy(),
    )
  })

  it('shows no topics panel when the map has no topic lines', async () => {
    mapWith('# Memory\n\n- [a fact](a-fact.md) — flat, old style\n')
    const { container } = render(<Personal tab="memory" dataRev={0} />)
    await waitFor(() => expect(api.item).toHaveBeenCalledWith('memory', 'MEMORY'))
    await waitFor(() => expect(container.querySelector('.library')).not.toBeNull())
    expect(screen.queryByRole('region', { name: 'Topics' })).toBeNull()
  })

  it('badges a seeded profile with the word "template"', async () => {
    api.profile.mockImplementation(() =>
      Promise.resolve({ exists: true, seeded: true, fingerprint: 'p1', text: '# Stub' }),
    )
    const { container } = render(<Personal tab="rules" dataRev={0} />)
    await waitFor(() => expect(badgeOf('Profile')?.textContent).toBe('template'))
    expect(container.textContent).not.toContain('●')
  })

  it('has at most one filled button on the rules tab with a trial rule open', async () => {
    const { container } = render(<Personal tab="rules" dataRev={0} />)
    fireEvent.click(await screen.findByText('Prefer tabs'))
    expect(screen.getByText('Graduate')).toBeTruthy()
    const filled = [...container.querySelectorAll('button.btn')].filter(
      (b) => !b.classList.contains('ghost'),
    )
    expect(filled.map((b) => b.textContent)).toEqual(['Add rule'])
  })
})
