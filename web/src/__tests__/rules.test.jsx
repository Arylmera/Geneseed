import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
      undefined,
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
        undefined,
      ),
    )
  })

  // `global` is a documented scope: the add form offers it and a save sends it.
  it('the add form offers scope: global and saves it', async () => {
    render(<Rules />)
    await waitFor(() => expect(screen.getByText('Add rule')).toBeTruthy())
    fireEvent.click(screen.getByText('Add rule'))
    fireEvent.change(screen.getByLabelText('Rule title'), { target: { value: 'New rule' } })
    fireEvent.change(screen.getByLabelText('Rule body'), { target: { value: 'Do the thing.' } })
    fireEvent.change(screen.getByLabelText('Rule scope'), { target: { value: 'global' } })
    fireEvent.click(screen.getByText('Save rule'))
    await waitFor(() =>
      expect(api.rulesMutate).toHaveBeenCalledWith(
        expect.objectContaining({ op: 'add', scope: 'global' }),
        undefined,
      ),
    )
  })

  // A global rule opens on the listed option, not on an extra "as written" one.
  it('editing a scope: global rule shows no extra option for it', async () => {
    const globalRule = { ...PAYLOAD.rules[0], scope: 'global' }
    api.rules.mockImplementation(() => Promise.resolve({ ...PAYLOAD, rules: [globalRule] }))
    render(<Rules />)
    await waitFor(() => expect(screen.getByText('No emoji in commits')).toBeTruthy())
    fireEvent.click(screen.getByText('No emoji in commits'))
    fireEvent.click(screen.getByText('Edit'))
    const select = screen.getByLabelText('Rule scope')
    expect(select.value).toBe('global')
    expect([...select.options].map((o) => o.value)).toEqual(['project', 'global'])
    expect(select.textContent).not.toMatch(/as written in the file/)
    fireEvent.click(screen.getByText('Save rule'))
    await waitFor(() =>
      expect(api.rulesMutate).toHaveBeenCalledWith(
        expect.objectContaining({ op: 'update', id: 1, scope: 'global' }),
        undefined,
      ),
    )
  })

  // `user` is an alias of `global` (the rule skill): the editor opens it on global, with no
  // extra option, and a save writes global.
  it('editing a scope: user rule shows global and saves global', async () => {
    render(<Rules />)
    fireEvent.click(await screen.findByText('Prefer tabs'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit R2' }))
    const select = screen.getByLabelText('Rule scope')
    expect(select.value).toBe('global')
    expect([...select.options].map((o) => o.value)).toEqual(['project', 'global'])
    fireEvent.click(screen.getByText('Save rule'))
    await waitFor(() =>
      expect(api.rulesMutate).toHaveBeenCalledWith(
        expect.objectContaining({ op: 'update', id: 2, scope: 'global' }),
        undefined,
      ),
    )
  })

  // The alias is applied on save only: opening and cancelling a user rule sends nothing,
  // and the row still shows the scope as written.
  it('an untouched scope: user rule is not rewritten', async () => {
    const confirm = vi.fn(async () => true)
    render(
      <ConfirmContext.Provider value={confirm}>
        <Rules />
      </ConfirmContext.Provider>,
    )
    fireEvent.click(await screen.findByText('Prefer tabs'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit R2' }))
    fireEvent.click(screen.getByText('Cancel'))
    await waitFor(() => expect(screen.queryByLabelText('Rule title')).toBeNull())
    expect(confirm).not.toHaveBeenCalled()
    expect(api.rulesMutate).not.toHaveBeenCalled()
    expect(screen.getByText('user')).toBeTruthy()
  })

  // A hand-written scope the skill does not document: the select must show it (not "project")
  // as an extra option, and a save must send it back unchanged.
  it('editing a hand-written scope keeps it in the form and the payload', async () => {
    const teamRule = { ...PAYLOAD.rules[0], scope: 'team' }
    api.rules.mockImplementation(() => Promise.resolve({ ...PAYLOAD, rules: [teamRule] }))
    render(<Rules />)
    await waitFor(() => expect(screen.getByText('No emoji in commits')).toBeTruthy())
    fireEvent.click(screen.getByText('No emoji in commits'))
    fireEvent.click(screen.getByText('Edit'))
    const select = screen.getByLabelText('Rule scope')
    expect(select.value).toBe('team')
    expect(select.selectedOptions[0].textContent).toBe('scope: team (as written in the file)')
    fireEvent.click(screen.getByText('Save rule'))
    await waitFor(() =>
      expect(api.rulesMutate).toHaveBeenCalledWith(
        expect.objectContaining({ op: 'update', id: 1, scope: 'team' }),
        undefined,
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
        undefined,
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
        tone: 'danger',
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

  // The budget meter moved to Personal's "Rule budget" panel (personal.test.jsx).

  it('labels the form fields with visible text and focuses the title on Add', async () => {
    render(<Rules />)
    fireEvent.click(await screen.findByText('Add rule'))
    for (const name of ['Rule title', 'Rule body', 'Rule scope']) {
      expect(screen.getByText(name).tagName).toBe('SPAN')
      expect(screen.getByLabelText(name)).toBeTruthy()
    }
    expect(document.activeElement).toBe(screen.getByLabelText('Rule title'))
  })

  it('says why Save is disabled while the title or body is missing', async () => {
    render(<Rules />)
    fireEvent.click(await screen.findByText('Add rule'))
    const save = screen.getByText('Save rule')
    expect(save.disabled).toBe(true)
    const hint = screen.getByText('A rule needs a title and a body.')
    expect(save.getAttribute('aria-describedby')).toBe(hint.id)
    fireEvent.change(screen.getByLabelText('Rule title'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('Rule body'), { target: { value: 'B' } })
    expect(screen.queryByText('A rule needs a title and a body.')).toBeNull()
    expect(save.getAttribute('aria-describedby')).toBeNull()
  })

  it('focuses the title when an edit opens', async () => {
    render(<Rules />)
    fireEvent.click(await screen.findByText('No emoji in commits'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit R1' }))
    expect(document.activeElement).toBe(screen.getByLabelText('Rule title'))
    expect(document.activeElement.value).toBe('No emoji in commits')
  })

  it('returns focus to Add rule after a new rule is saved', async () => {
    render(<Rules />)
    fireEvent.click(await screen.findByText('Add rule'))
    fireEvent.change(screen.getByLabelText('Rule title'), { target: { value: 'New rule' } })
    fireEvent.change(screen.getByLabelText('Rule body'), { target: { value: 'Do the thing.' } })
    fireEvent.click(screen.getByText('Save rule'))
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add rule' })),
    )
  })

  it('returns focus to Add rule after an untouched new rule is cancelled', async () => {
    render(<Rules />)
    fireEvent.click(await screen.findByText('Add rule'))
    fireEvent.click(screen.getByText('Cancel'))
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add rule' })),
    )
  })

  it('returns focus to Add rule after a retire', async () => {
    render(
      <ConfirmContext.Provider value={async () => true}>
        <Rules />
      </ConfirmContext.Provider>,
    )
    fireEvent.click(await screen.findByText('No emoji in commits'))
    fireEvent.click(screen.getByRole('button', { name: 'Retire R1' }))
    await waitFor(() =>
      expect(api.rulesMutate).toHaveBeenCalledWith(
        expect.objectContaining({ op: 'delete', id: 1 }),
        undefined,
      ),
    )
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add rule' })),
    )
  })

  it('returns focus to Add rule after retiring the last rule', async () => {
    let calls = 0
    api.rules.mockImplementation(() =>
      Promise.resolve(
        ++calls === 1
          ? { ...PAYLOAD, rules: [PAYLOAD.rules[0]] }
          : { ...PAYLOAD, rules: [], stats: { ...STATS, rules: 0 } },
      ),
    )
    render(
      <ConfirmContext.Provider value={async () => true}>
        <Rules />
      </ConfirmContext.Provider>,
    )
    fireEvent.click(await screen.findByText('No emoji in commits'))
    fireEvent.click(screen.getByRole('button', { name: 'Retire R1' }))
    expect(await screen.findByText('No rules yet')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add rule' }))
  })

  it('returns focus to the row head after a graduate', async () => {
    render(<Rules />)
    fireEvent.click(await screen.findByText('Prefer tabs'))
    fireEvent.click(screen.getByRole('button', { name: 'Graduate R2' }))
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /Prefer tabs/ })),
    )
  })

  it('returns focus to the row head after an edit is saved', async () => {
    render(<Rules />)
    fireEvent.click(await screen.findByText('No emoji in commits'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit R1' }))
    fireEvent.change(screen.getByLabelText('Rule body'), { target: { value: 'Changed.' } })
    fireEvent.click(screen.getByText('Save rule'))
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: /No emoji in commits/ }),
      ),
    )
  })

  it('announces the conflict notice as a status, not an alert', async () => {
    api.rulesMutate.mockImplementationOnce(() => Promise.reject(conflict()))
    render(<Rules />)
    fireEvent.click(await screen.findByText('Prefer tabs'))
    fireEvent.click(screen.getByText('Graduate'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Try again/))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('names each row action after its rule, and Graduate is a secondary button', async () => {
    render(<Rules />)
    fireEvent.click(await screen.findByText('Prefer tabs'))
    const graduate = screen.getByRole('button', { name: 'Graduate R2' })
    expect(graduate.className).toBe('btn ghost sm')
    expect(screen.getByRole('button', { name: 'Edit R2' }).textContent).toBe('Edit')
    expect(screen.getByRole('button', { name: 'Retire R2' }).textContent).toBe('Retire')
  })
})

// EVERY ACTIVE INSTALL'S RULES IN ONE LIST (D1). Two installs, each with its own user-rules.md
// and fingerprint: the rows of both are listed, each tagged with its install; a write on a row
// goes back to THAT install with THAT file's fingerprint; a new rule goes where its form's own
// "Write to:" picker says, starting on the server's default row.
describe('Rules across installs', () => {
  const OC = { id: 'oc', host: 'opencode', scope: 'global', path: '/oc', state: 'active' }
  const CL = {
    id: 'cl',
    host: 'claude',
    scope: 'global',
    path: '/cl',
    state: 'active',
    default: true,
  }
  const ocRules = { ...PAYLOAD, fingerprint: 'oc-fp', rules: [PAYLOAD.rules[0]] }
  const clRules = {
    ...PAYLOAD,
    fingerprint: 'cl-fp',
    rules: [{ ...PAYLOAD.rules[0], title: 'Claude only' }],
  }
  beforeEach(() => {
    api.installs = vi.fn(async () => ({ installs: [OC, CL] }))
    api.rules.mockImplementation((inst) =>
      Promise.resolve(inst?.host === 'opencode' ? ocRules : clRules),
    )
  })
  afterEach(() => {
    delete api.installs
  })

  // Two installs listed but one writable: no picker to hide behind, the form names its target.
  it('names the one writable target beside the form', async () => {
    api.rules.mockImplementation((inst) =>
      Promise.resolve(
        inst?.host === 'opencode' ? { ...ocRules, exists: false, rules: [] } : clRules,
      ),
    )
    render(<Rules />)
    fireEvent.click(await screen.findByText('Add rule'))
    expect(screen.queryByRole('combobox', { name: 'Write to:' })).toBeNull()
    expect(document.querySelector('.rule-form .install-pick').textContent).toBe(
      'Write to: claude · global',
    )
  })

  // One unreadable file leaves the others listed and is named, never a whole-page error.
  it('lists the readable installs and names the one that failed', async () => {
    api.rules.mockImplementation((inst) =>
      inst?.host === 'opencode' ? Promise.reject(new Error('EACCES')) : Promise.resolve(clRules),
    )
    render(<Rules />)
    await screen.findByText('Claude only')
    expect(screen.getByText('Could not read user-rules.md of opencode · global.')).toBeTruthy()
  })

  it('lists both installs, each row tagged with its own', async () => {
    render(<Rules />)
    await screen.findByText('Claude only')
    expect(screen.getByText('No emoji in commits')).toBeTruthy()
    const tags = [...document.querySelectorAll('.rule-head')].map(
      (h) => h.querySelector('.rule-chip').textContent,
    )
    // The default install's rules first, then the others in the server's order.
    expect(tags).toEqual(['claude · global', 'opencode · global'])
  })

  it('retires a rule from the install it came from, with that file fingerprint', async () => {
    render(
      <ConfirmContext.Provider value={async () => true}>
        <Rules />
      </ConfirmContext.Provider>,
    )
    fireEvent.click(await screen.findByText('No emoji in commits'))
    fireEvent.click(screen.getByRole('button', { name: 'Retire R1 · opencode · global' }))
    await waitFor(() =>
      expect(api.rulesMutate).toHaveBeenCalledWith(
        { op: 'delete', id: 1, fingerprint: 'oc-fp' },
        { host: 'opencode', path: '/oc' },
      ),
    )
  })

  it('adds a new rule to the install its form picks, default first', async () => {
    render(<Rules />)
    fireEvent.click(await screen.findByText('Add rule'))
    const to = screen.getByRole('combobox', { name: 'Write to:' })
    expect(to.value).toBe('cl')
    fireEvent.change(to, { target: { value: 'oc' } })
    fireEvent.change(screen.getByLabelText('Rule title'), { target: { value: 'New rule' } })
    fireEvent.change(screen.getByLabelText('Rule body'), { target: { value: 'Do the thing.' } })
    fireEvent.click(screen.getByText('Save rule'))
    await waitFor(() =>
      expect(api.rulesMutate).toHaveBeenCalledWith(
        expect.objectContaining({ op: 'add', title: 'New rule', fingerprint: 'oc-fp' }),
        { host: 'opencode', path: '/oc' },
      ),
    )
  })
})
