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
import { ConfirmContext } from '../hooks/useConfirm.jsx'

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

// What post() rejects with on a refused write.
const conflict = () => Object.assign(new Error('conflict'), { status: 409 })

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

  // A hand-written scope outside project/user: the select must show it (not "project") and
  // a save must send it back unchanged.
  it('editing a scope: global rule keeps global in the form and the payload', async () => {
    const globalRule = { ...PAYLOAD.rules[0], scope: 'global' }
    api.rules.mockImplementation(() => Promise.resolve({ ...PAYLOAD, rules: [globalRule] }))
    render(<Rules />)
    await waitFor(() => expect(screen.getByText('No emoji in commits')).toBeTruthy())
    fireEvent.click(screen.getByText('No emoji in commits'))
    fireEvent.click(screen.getByText('Edit'))
    expect(screen.getByLabelText('Rule scope').value).toBe('global')
    fireEvent.click(screen.getByText('Save rule'))
    await waitFor(() =>
      expect(api.rulesMutate).toHaveBeenCalledWith(
        expect.objectContaining({ op: 'update', id: 1, scope: 'global' }),
      ),
    )
  })

  it('a body line starting "## " shows the error and does not save', async () => {
    render(<Rules />)
    await waitFor(() => expect(screen.getByText('Add rule')).toBeTruthy())
    fireEvent.click(screen.getByText('Add rule'))
    fireEvent.change(screen.getByLabelText('Rule title'), { target: { value: 'New rule' } })
    fireEvent.change(screen.getByLabelText('Rule body'), {
      target: { value: 'Line A\n## R2 — x' },
    })
    expect(screen.getByRole('alert').textContent).toMatch(/cannot start with “## ”/)
    fireEvent.click(screen.getByText('Save rule'))
    expect(api.rulesMutate).not.toHaveBeenCalled()
  })

  it('a 409 conflict shows the reload notice instead of clobbering', async () => {
    api.rulesMutate.mockImplementationOnce(() => Promise.reject(conflict()))
    let calls = 0
    api.rules.mockImplementation(() =>
      Promise.resolve(
        ++calls === 1
          ? PAYLOAD
          : { ...PAYLOAD, rules: [PAYLOAD.rules[0], { ...PAYLOAD.rules[1], title: 'Agent tabs' }] },
      ),
    )
    render(<Rules />)
    await waitFor(() => expect(screen.getByText('Prefer tabs')).toBeTruthy())
    fireEvent.click(screen.getByText('Prefer tabs'))
    fireEvent.click(screen.getByText('Graduate'))
    // No draft to keep on a Graduate: the notice says to try again.
    await waitFor(() => expect(screen.getByText(/changed on disk.*Try again/)).toBeTruthy())
    // and the page shows the fresh copy it re-fetched
    await waitFor(() => expect(screen.getByText('Agent tabs')).toBeTruthy())
  })

  // An edit refused by a newer version keeps the draft in the form; the reload brings the
  // new fingerprint, and Save again carries it.
  it('a 409 on an edit save keeps the draft and the next save sends the new fingerprint', async () => {
    api.rulesMutate.mockImplementationOnce(() => Promise.reject(conflict()))
    let calls = 0
    api.rules.mockImplementation(() =>
      Promise.resolve(++calls === 1 ? PAYLOAD : { ...PAYLOAD, fingerprint: 'f9' }),
    )
    render(<Rules />)
    await waitFor(() => expect(screen.getByText('No emoji in commits')).toBeTruthy())
    fireEvent.click(screen.getByText('No emoji in commits'))
    fireEvent.click(screen.getByText('Edit'))
    fireEvent.change(screen.getByLabelText('Rule body'), { target: { value: 'Draft body' } })
    fireEvent.click(screen.getByText('Save rule'))
    await waitFor(() => expect(screen.getByText(/Your draft is kept/)).toBeTruthy())
    await waitFor(() => expect(api.rules).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText('Rule body').value).toBe('Draft body')
    fireEvent.click(screen.getByText('Save rule'))
    await waitFor(() =>
      expect(api.rulesMutate).toHaveBeenLastCalledWith(
        expect.objectContaining({ op: 'update', id: 1, body: 'Draft body', fingerprint: 'f9' }),
      ),
    )
  })

  // The rule under an open draft vanished from the file (an agent removed or renumbered
  // it): the draft survives in the new-rule card, and Save ADDS it — an update by id
  // could overwrite whichever rule took that number.
  it('a draft whose rule is gone after a reload is kept and saves as a new rule', async () => {
    api.rulesMutate.mockImplementationOnce(() => Promise.reject(conflict()))
    let calls = 0
    api.rules.mockImplementation(() =>
      Promise.resolve(
        ++calls === 1 ? PAYLOAD : { ...PAYLOAD, fingerprint: 'f9', rules: [PAYLOAD.rules[1]] },
      ),
    )
    render(<Rules />)
    await waitFor(() => expect(screen.getByText('No emoji in commits')).toBeTruthy())
    fireEvent.click(screen.getByText('No emoji in commits'))
    fireEvent.click(screen.getByText('Edit'))
    fireEvent.change(screen.getByLabelText('Rule body'), { target: { value: 'Draft body' } })
    fireEvent.click(screen.getByText('Save rule'))
    await waitFor(() =>
      expect(screen.getByText(/Rule R1 is no longer in user-rules.md/)).toBeTruthy(),
    )
    expect(screen.getByLabelText('Rule body').value).toBe('Draft body')
    expect(screen.queryByText('Add rule')).toBeNull()
    fireEvent.click(screen.getByText('Save rule'))
    await waitFor(() => expect(api.rulesMutate).toHaveBeenCalledTimes(2))
    const sent = api.rulesMutate.mock.lastCall[0]
    expect(sent).toEqual({
      op: 'add',
      title: 'No emoji in commits',
      body: 'Draft body',
      scope: 'project',
      trial_until: '',
      fingerprint: 'f9',
    })
  })

  // A renumber can put a DIFFERENT rule under the draft's id: same id, other title is gone
  // too, or Save would overwrite that other rule.
  it('a draft whose id now holds another rule saves as a new rule, not an update', async () => {
    api.rulesMutate.mockImplementationOnce(() => Promise.reject(conflict()))
    let calls = 0
    api.rules.mockImplementation(() =>
      Promise.resolve(
        ++calls === 1
          ? PAYLOAD
          : {
              ...PAYLOAD,
              fingerprint: 'f9',
              rules: [{ ...PAYLOAD.rules[0], title: 'Other' }, PAYLOAD.rules[1]],
            },
      ),
    )
    render(<Rules />)
    await waitFor(() => expect(screen.getByText('No emoji in commits')).toBeTruthy())
    fireEvent.click(screen.getByText('No emoji in commits'))
    fireEvent.click(screen.getByText('Edit'))
    fireEvent.change(screen.getByLabelText('Rule body'), { target: { value: 'Draft body' } })
    fireEvent.click(screen.getByText('Save rule'))
    await waitFor(() =>
      expect(screen.getByText(/Rule R1 is no longer in user-rules.md/)).toBeTruthy(),
    )
    fireEvent.click(screen.getByText('Save rule'))
    await waitFor(() => expect(api.rulesMutate).toHaveBeenCalledTimes(2))
    expect(api.rulesMutate.mock.lastCall[0]).toEqual({
      op: 'add',
      title: 'No emoji in commits',
      body: 'Draft body',
      scope: 'project',
      trial_until: '',
      fingerprint: 'f9',
    })
  })

  it('Cancel on a changed draft asks first; "keep" leaves the draft open', async () => {
    const confirm = vi.fn(async () => false)
    render(
      <ConfirmContext.Provider value={confirm}>
        <Rules />
      </ConfirmContext.Provider>,
    )
    await waitFor(() => expect(screen.getByText('Add rule')).toBeTruthy())
    fireEvent.click(screen.getByText('Add rule'))
    fireEvent.change(screen.getByLabelText('Rule title'), { target: { value: 'Half typed' } })
    fireEvent.click(screen.getByText('Cancel'))
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith('Discard your unsaved edit?', {
        title: 'Unsaved edit',
        confirmLabel: 'Discard',
      }),
    )
    expect(screen.getByLabelText('Rule title').value).toBe('Half typed')
  })

  it('Cancel on an untouched draft closes without asking', async () => {
    const confirm = vi.fn(async () => false)
    render(
      <ConfirmContext.Provider value={confirm}>
        <Rules />
      </ConfirmContext.Provider>,
    )
    await waitFor(() => expect(screen.getByText('Add rule')).toBeTruthy())
    fireEvent.click(screen.getByText('Add rule'))
    fireEvent.click(screen.getByText('Cancel'))
    await waitFor(() => expect(screen.queryByLabelText('Rule title')).toBeNull())
    expect(confirm).not.toHaveBeenCalled()
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
