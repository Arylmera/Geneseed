import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The Overview fleet's "Hand edits" cell. A `linked` path is the user's own link (a skill dir
// junctioned to their copy), which no rebuild clears: it never counts as a hand edit and never
// offers Rebuild. When it is all there is, the cell says "N linked", muted; next to real edits
// the cell shows the edits alone.

vi.mock('../api/index.js', () => ({
  api: {
    fleet: vi.fn(),
    usage: vi.fn(),
    gates: vi.fn(),
    update: vi.fn(),
    rules: vi.fn(),
    activity: vi.fn(),
    profile: vi.fn(),
    catalog: vi.fn(),
  },
}))

import Ledger from '../pages/Overview/Ledger.jsx'
import { api } from '../api/index.js'

const row = (drift) => ({
  id: 'claude:global:/h/.claude',
  host: 'claude',
  scope: 'global',
  path: '/h/.claude',
  state: 'active',
  theme: 'neutral',
  footprint: 'lean',
  verdict: 'synced',
  diffable: true,
  drift,
  built_epoch: null,
  cost: null,
})

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of ['usage', 'gates', 'update', 'rules', 'activity', 'profile', 'catalog']) {
    api[k].mockImplementation(() => Promise.resolve(null))
  }
})

const cell = async () => {
  const table = await screen.findByRole('table', { name: 'Installs' })
  return within(table)
}

describe('Ledger hand-edits cell', () => {
  it('shows only linked paths as a muted "linked" figure, with no Rebuild', async () => {
    api.fleet.mockResolvedValue({
      installs: [row({ edited: 0, added: 0, missing: 0, linked: 2 })],
    })
    render(<Ledger overview={null} onAction={() => {}} />)
    const t = await cell()
    const linked = await t.findByText('2 linked')
    expect(linked.className).toContain('dim')
    expect(t.queryByText(/edited/)).toBeNull()
    expect(t.queryByText(/Rebuild/)).toBeNull()
  })

  // Stale files are unedited ones a rebuild updates: they join the Sync cell as "behind",
  // never the hand-edits figure.
  it('shows stale files as behind in the Sync cell, not as edits', async () => {
    api.fleet.mockResolvedValue({
      installs: [
        {
          ...row({ edited: 0, added: 0, missing: 0, linked: 0, stale: 3 }),
          verdict: 'behind',
        },
      ],
    })
    render(<Ledger overview={null} onAction={() => {}} />)
    const t = await cell()
    expect(await t.findByText('3 files behind')).toBeTruthy()
    expect(t.queryByText(/edited/)).toBeNull()
    expect(t.getByText('none')).toBeTruthy()
    expect(t.getByText('Rebuild')).toBeTruthy()
  })

  it('says a zero ceiling is no ceiling, not a percentage', async () => {
    api.fleet.mockResolvedValue({
      installs: [
        {
          ...row({ edited: 0, added: 0, missing: 0, linked: 0, stale: 0 }),
          cost: { carrier: 100, skills: 0, agents: 0, context: 0, ceiling: 0 },
        },
      ],
    })
    render(<Ledger overview={null} onAction={() => {}} />)
    const t = await cell()
    expect(await t.findByText('no ceiling')).toBeTruthy()
    expect(t.queryByText(/% of ceiling/)).toBeNull()
  })

  // A failed fleet read says so and offers a retry, instead of an empty table and a verdict
  // that spins forever.
  it('says the installs could not be read, and Retry asks again', async () => {
    api.fleet.mockRejectedValueOnce(new Error('daemon down'))
    render(<Ledger overview={null} onAction={() => {}} />)
    const t = await cell()
    expect(await t.findByRole('status')).toHaveProperty(
      'textContent',
      'Could not read the installs',
    )
    expect(screen.getByText('Status unknown')).toBeTruthy()
    api.fleet.mockResolvedValue({
      installs: [row({ edited: 1, added: 0, missing: 0, linked: 0, stale: 0 })],
    })
    fireEvent.click(t.getByText('Retry'))
    expect(await t.findByText('1 edited')).toBeTruthy()
    expect(api.fleet).toHaveBeenCalledTimes(2)
  })

  it('keeps the last read under a status line when a refresh fails', async () => {
    api.fleet.mockResolvedValueOnce({
      installs: [row({ edited: 1, added: 0, missing: 0, linked: 0, stale: 0 })],
    })
    const { rerender } = render(<Ledger overview={null} onAction={() => {}} dataRev={0} />)
    const t = await cell()
    expect(await t.findByText('1 edited')).toBeTruthy()
    api.fleet.mockRejectedValueOnce(new Error('daemon down'))
    rerender(<Ledger overview={null} onAction={() => {}} dataRev={1} />)
    const line = await screen.findByText(/Could not refresh the installs/)
    expect(line.getAttribute('role')).toBe('status')
    expect(t.getByText('1 edited')).toBeTruthy()
  })

  it('counts real edits without the linked paths', async () => {
    api.fleet.mockResolvedValue({
      installs: [row({ edited: 1, added: 0, missing: 0, linked: 2 })],
    })
    render(<Ledger overview={null} onAction={() => {}} />)
    const t = await cell()
    expect(await t.findByText('1 edited')).toBeTruthy()
    expect(t.queryByText('2 linked')).toBeNull()
    expect(t.getByText('Rebuild')).toBeTruthy()
  })
})
