import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api/index.js', () => ({
  api: {
    rules: vi.fn(),
    rulesMutate: vi.fn(() => Promise.resolve({ ok: true, fingerprint: 'f2' })),
    rulesPromote: vi.fn(() => Promise.resolve({ ok: true })),
  },
}))

import Rules from '../pages/Rules.jsx'
import { api } from '../api/index.js'

const STATS = { rules: 2, lines: 20, tokens: 300, max_rules: 15, max_tokens: 1500 }
const PAYLOAD = {
  exists: true,
  path: '/x/user-rules.md',
  fingerprint: 'f1',
  warnings: [],
  stats: STATS,
  rules: [
    {
      id: 1,
      title: 'No emoji in commits',
      scope: 'project',
      source: '',
      trial_until: '',
      status: 'active',
      overdue: false,
      body: 'Commit subjects are plain text.',
    },
    {
      id: 2,
      title: 'Prefer tabs',
      scope: 'user',
      source: 'memory prefer-tabs, promoted 2026-07-07',
      trial_until: '2026-08-06',
      status: 'trial',
      overdue: false,
      body: 'Always use tabs in this repo.',
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  api.rules.mockImplementation(() => Promise.resolve(PAYLOAD))
})

describe('Rules', () => {
  it('renders the rule rows with scope and trial chips', async () => {
    render(<Rules />)
    await waitFor(() => expect(screen.getByText('No emoji in commits')).toBeTruthy())
    expect(screen.getByText('Prefer tabs')).toBeTruthy()
    expect(screen.getByText('project')).toBeTruthy()
    expect(screen.getByText('user')).toBeTruthy()
    expect(screen.getByText(/trial · 2026-08-06/)).toBeTruthy()
    // budget meter shows count and token spend
    expect(screen.getByText(/2\/15 rules/)).toBeTruthy()
  })

  it('expands a row to its body, provenance, and actions', async () => {
    render(<Rules />)
    await waitFor(() => expect(screen.getByText('Prefer tabs')).toBeTruthy())
    fireEvent.click(screen.getByText('Prefer tabs'))
    expect(screen.getByText('Always use tabs in this repo.')).toBeTruthy()
    expect(screen.getByText(/source: memory prefer-tabs/)).toBeTruthy()
    // a trial rule offers Graduate; every rule offers Edit/Retire
    expect(screen.getByText('Graduate')).toBeTruthy()
    expect(screen.getByText('Edit')).toBeTruthy()
    expect(screen.getByText('Retire')).toBeTruthy()
  })

  it('graduating a trial rule updates it with the trial marker dropped', async () => {
    render(<Rules />)
    await waitFor(() => expect(screen.getByText('Prefer tabs')).toBeTruthy())
    fireEvent.click(screen.getByText('Prefer tabs'))
    fireEvent.click(screen.getByText('Graduate'))
    await waitFor(() => expect(api.rulesMutate).toHaveBeenCalled())
    expect(api.rulesMutate).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'update', id: 2, trial_until: '', fingerprint: 'f1' }),
    )
  })

  it('adds a rule through the form, sending the loaded fingerprint', async () => {
    render(<Rules />)
    await waitFor(() => expect(screen.getByText('Add rule')).toBeTruthy())
    fireEvent.click(screen.getByText('Add rule'))
    fireEvent.change(screen.getByLabelText('Rule title'), { target: { value: 'New rule' } })
    fireEvent.change(screen.getByLabelText('Rule body'), { target: { value: 'Do the thing.' } })
    fireEvent.click(screen.getByText('Save rule'))
    await waitFor(() =>
      expect(api.rulesMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'add',
          title: 'New rule',
          body: 'Do the thing.',
          scope: 'project',
          fingerprint: 'f1',
        }),
      ),
    )
  })

  it('a 409 conflict shows the reload notice instead of clobbering', async () => {
    const err = new Error('conflict')
    err.status = 409
    api.rulesMutate.mockImplementationOnce(() => Promise.reject(err))
    render(<Rules />)
    await waitFor(() => expect(screen.getByText('Prefer tabs')).toBeTruthy())
    fireEvent.click(screen.getByText('Prefer tabs'))
    fireEvent.click(screen.getByText('Graduate'))
    await waitFor(() => expect(screen.getByText(/changed on disk/)).toBeTruthy())
    // and the page re-fetched the fresh copy
    expect(api.rules.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('shows the seeded-but-empty state with the in-session routes', async () => {
    api.rules.mockImplementation(() =>
      Promise.resolve({ ...PAYLOAD, rules: [], stats: { ...STATS, rules: 0, tokens: 100 } }),
    )
    render(<Rules />)
    await waitFor(() => expect(screen.getByText('No rules yet')).toBeTruthy())
    expect(screen.getByText(/promote a recurring memory fact/)).toBeTruthy()
  })

  it('shows the not-seeded state when user-rules.md is missing', async () => {
    api.rules.mockImplementation(() =>
      Promise.resolve({
        exists: false,
        path: '/x/user-rules.md',
        fingerprint: '',
        warnings: [],
        rules: [],
        stats: { ...STATS, rules: 0, lines: 0, tokens: 0 },
      }),
    )
    render(<Rules />)
    await waitFor(() => expect(screen.getByText(/No user-rules.md here yet/)).toBeTruthy())
    expect(screen.queryByText('Add rule')).toBeNull()
  })

  it('turns the meter over budget with the dilution warning', async () => {
    api.rules.mockImplementation(() =>
      Promise.resolve({ ...PAYLOAD, stats: { ...STATS, rules: 16 } }),
    )
    render(<Rules />)
    await waitFor(() => expect(screen.getByText(/over budget/)).toBeTruthy())
  })
})
