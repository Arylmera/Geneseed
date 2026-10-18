import React from 'react'
import { render, screen, within } from '@testing-library/react'
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
    selectView: vi.fn(),
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
  const table = (await screen.findByText('Hand edits')).closest('table')
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
    expect(t.queryByText('Rebuild')).toBeNull()
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
