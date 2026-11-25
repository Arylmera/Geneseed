import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Personal, with the real Rules editor under it: counts that come from the folder the pane lists,
// and one filled action per view. Memory was a tab here; its tests moved with it (memory.test.jsx).

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
      await screen.findByText(/Global installs share one copy of the rules and profile/)
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

  it('badges a seeded profile with the word "template"', async () => {
    api.profile.mockImplementation(() =>
      Promise.resolve({ exists: true, seeded: true, fingerprint: 'p1', text: '# Stub' }),
    )
    const { container } = render(<Personal tab="rules" dataRev={0} />)
    await waitFor(() => expect(badgeOf('Profile')?.textContent).toBe('template'))
    expect(container.textContent).not.toContain('●')
  })

  // A failed read is not a profile without a template: the badge says the read failed.
  it('badges a profile that could not be read as "read failed"', async () => {
    api.profile.mockImplementation(() => Promise.reject(new Error('down')))
    render(<Personal tab="rules" dataRev={0} />)
    await waitFor(() => expect(badgeOf('Profile')?.textContent).toBe('read failed'))
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
