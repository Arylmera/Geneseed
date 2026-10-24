import React from 'react'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Personal, with the real Rules editor under it: ONE budget strip (the Rules meter is gone),
// one threshold rule for that strip, counts that come from the folder the pane lists, and one
// filled action per view.

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
}
const rulesWith = (stats) => ({
  exists: true,
  fingerprint: 'f1',
  warnings: [],
  stats: { rules: 2, lines: 20, tokens: 300, max_rules: 15, max_tokens: 1500, ...stats },
  rules: [TRIAL],
})
const entries = (n) => Array.from({ length: n }, (_, i) => ({ name: `fact-${i}`, title: '' }))
// The folder's index and README sit in the listing beside the entries.
const FURNITURE = [{ name: 'MEMORY' }, { name: 'README' }]

let memoryItems
beforeEach(() => {
  vi.clearAllMocks()
  memoryItems = [...FURNITURE, ...entries(3)]
  api.rules.mockImplementation(() => Promise.resolve(rulesWith({})))
  api.profile.mockImplementation(() =>
    Promise.resolve({ exists: true, seeded: false, fingerprint: 'p1', text: '# Me' }),
  )
  api.catalog.mockImplementation((section) =>
    Promise.resolve({
      section,
      items: section === 'memory' ? memoryItems : [{ name: 'NOTEBOOK' }, { name: 'plan' }],
    }),
  )
  api.item.mockImplementation(() => Promise.resolve({ title: '', desc: '', body: '', links: [] }))
})

// `setup.facts` disagrees with the catalog on purpose: the counts must come from the catalog.
const SETUP = { facts: 5 }
const budget = () => screen.findByRole('region', { name: 'Rule budget' })
const badgeOf = (tab) =>
  screen.getByRole('link', { name: new RegExp(`^${tab}`) }).querySelector('.tab-badge')

describe('Personal', () => {
  it('shows one budget strip: slots, a token bar, and no meter in the Rules editor', async () => {
    const { container } = render(<Personal tab="rules" setup={SETUP} dataRev={0} />)
    const panel = await budget()
    await screen.findByText('Prefer tabs')
    expect(screen.getAllByRole('region', { name: 'Rule budget' })).toHaveLength(1)
    expect(within(panel).getByText('2 of 15')).toBeTruthy()
    expect(within(panel).getByRole('img', { name: 'tokens: 300 of 1500' })).toBeTruthy()
    // Below both thresholds the note is the file's size.
    expect(within(panel).getByText('2 rules in 20 lines.')).toBeTruthy()
    expect(container.querySelector('.rules-meter')).toBeNull()
  })

  // Tokens alone reach 70 % (1050/1500) while the count is at 13 %: the strip reads the max.
  it('warns at 70 % of either budget', async () => {
    api.rules.mockImplementation(() => Promise.resolve(rulesWith({ tokens: 1050 })))
    render(<Personal tab="rules" dataRev={0} />)
    const panel = await budget()
    expect(within(panel).getByText('getting heavy; consider merging or pruning')).toBeTruthy()
  })

  it('says over budget at 100 % of either budget', async () => {
    api.rules.mockImplementation(() => Promise.resolve(rulesWith({ rules: 15 })))
    render(<Personal tab="rules" dataRev={0} />)
    const panel = await budget()
    expect(
      within(panel).getByText('over budget: a bloated rule set dilutes the rules that matter'),
    ).toBeTruthy()
  })

  it('counts one fact in the singular', async () => {
    memoryItems = [...FURNITURE, ...entries(1)]
    render(<Personal tab="rules" setup={SETUP} dataRev={0} />)
    const known = await screen.findByRole('region', { name: 'What the agent knows about you' })
    await waitFor(() => expect(within(known).getByText('1 fact')).toBeTruthy())
  })

  it('counts 237 facts in the plural', async () => {
    memoryItems = [...FURNITURE, ...entries(237)]
    render(<Personal tab="rules" setup={SETUP} dataRev={0} />)
    const known = await screen.findByRole('region', { name: 'What the agent knows about you' })
    await waitFor(() => expect(within(known).getByText('237 facts')).toBeTruthy())
    expect(within(known).getByText('1 note')).toBeTruthy()
  })

  it('badges the Memory tab with the catalog entries, not its index or README', async () => {
    render(<Personal tab="rules" setup={SETUP} dataRev={0} />)
    await waitFor(() => expect(badgeOf('Memory')?.textContent).toBe('3'))
  })

  it('ignores the furniture names in any case', async () => {
    memoryItems = [{ name: 'memory' }, { name: 'Readme' }, ...entries(2)]
    render(<Personal tab="rules" dataRev={0} />)
    await waitFor(() => expect(badgeOf('Memory')?.textContent).toBe('2'))
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
    memoryItems = [...FURNITURE]
    const { container } = render(<Personal tab="memory" setup={SETUP} dataRev={0} />)
    expect(await screen.findByText('No facts yet')).toBeTruthy()
    expect(screen.getByText(/remember that…/)).toBeTruthy()
    expect(container.querySelector('.library')).toBeNull()
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
