import React from 'react'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../api/index.js', () => ({
  api: {
    profile: vi.fn(),
    profileSave: vi.fn(() => Promise.resolve({ ok: true, fingerprint: 'f2' })),
  },
}))

import Profile from '../pages/Profile.jsx'
import { api } from '../api/index.js'

const FILLED = {
  exists: true,
  path: '/x/PROFILE.md',
  fingerprint: 'f1',
  text: '# Who I am\n\nA builder.',
}

const texts = (sel) => [...document.querySelectorAll(sel)].map((n) => n.textContent)

beforeEach(() => {
  vi.clearAllMocks()
  api.profile.mockImplementation(() => Promise.resolve(FILLED))
})

describe('Profile', () => {
  it('opens a set-up profile as rendered markdown, no editor', async () => {
    render(<Profile />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Who I am' })).toBeTruthy())
    expect(screen.queryByLabelText('Profile markdown')).toBeNull()
  })

  it('switches to the editor and saves back to view', async () => {
    render(<Profile />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Who I am' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const box = screen.getByLabelText('Profile markdown')
    fireEvent.change(box, { target: { value: '# Who I am\n\nA builder, revised.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.profileSave).toHaveBeenCalledWith(
        {
          text: '# Who I am\n\nA builder, revised.',
          fingerprint: 'f1',
        },
        undefined,
      ),
    )
    // successful save lands back on the rendered view
    await waitFor(() => expect(screen.queryByLabelText('Profile markdown')).toBeNull())
  })

  it('keeps the draft on screen when the save is refused by a newer version', async () => {
    // A refused save reloads to learn the new fingerprint. It used to also replace the
    // textarea with the disk copy — the user's edit vanished without a word. The server
    // refuses with a 409, which post() turns into a REJECTION (not a resolved {ok:false}).
    api.profileSave.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error('conflict'), { status: 409 })),
    )
    let calls = 0
    api.profile.mockImplementation(() =>
      Promise.resolve(
        // Two reads before the save: the page's, for the path, and the card's own.
        ++calls <= 2 ? FILLED : { ...FILLED, fingerprint: 'f9', text: '# Agent wrote this' },
      ),
    )
    render(<Profile />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Who I am' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Profile markdown'), { target: { value: 'my draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.profile).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(screen.getByText(/Your draft is kept/)).toBeTruthy())
    expect(screen.getByLabelText('Profile markdown').value).toBe('my draft')
    // …and the next save carries the NEW fingerprint.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.profileSave).toHaveBeenLastCalledWith(
        { text: 'my draft', fingerprint: 'f9' },
        undefined,
      ),
    )
  })

  it('opens straight in the editor when the profile is empty', async () => {
    api.profile.mockImplementation(() =>
      Promise.resolve({ exists: false, fingerprint: '', text: '' }),
    )
    render(<Profile />)
    await waitFor(() => expect(screen.getByLabelText('Profile markdown')).toBeTruthy())
  })

  it('marks the pressed mode with aria-pressed, in both modes', async () => {
    render(<Profile />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Who I am' })).toBeTruthy())
    const view = screen.getByRole('button', { name: 'View' })
    const edit = screen.getByRole('button', { name: 'Edit' })
    expect([view.getAttribute('aria-pressed'), edit.getAttribute('aria-pressed')]).toEqual([
      'true',
      'false',
    ])
    fireEvent.click(edit)
    expect([view.getAttribute('aria-pressed'), edit.getAttribute('aria-pressed')]).toEqual([
      'false',
      'true',
    ])
  })

  it('a seeded profile says it is still the template, and the Edit switch opens the editor', async () => {
    api.profile.mockImplementation(() =>
      Promise.resolve({ ...FILLED, seeded: true, text: '# Your profile\n\nStub.' }),
    )
    render(<Profile />)
    expect(await screen.findByText('This is still the template')).toBeTruthy()
    // The rendered stub stays under the panel.
    expect(screen.getByRole('heading', { name: 'Your profile' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit it here' })).toBeNull()
    const button = screen.getByRole('button', { name: 'Edit' })
    fireEvent.click(button)
    expect(screen.getByLabelText('Profile markdown').value).toBe('# Your profile\n\nStub.')
    expect(screen.queryByText('This is still the template')).toBeNull()
  })

  it('saving the template drops the template panel at once', async () => {
    // The disk read after the save stays pending, so only the painted copy can answer.
    let calls = 0
    api.profile.mockImplementation(() =>
      ++calls <= 2
        ? Promise.resolve({ ...FILLED, seeded: true, text: '# Your profile\n\nStub.' })
        : new Promise(() => {}),
    )
    render(<Profile />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Profile markdown'), {
      target: { value: '# Mine\n\nWritten.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('heading', { name: 'Mine' })).toBeTruthy()
    expect(screen.queryByText('This is still the template')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Saved.')
  })

  it('a written profile shows no template panel', async () => {
    render(<Profile />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Who I am' })).toBeTruthy())
    expect(screen.queryByText('This is still the template')).toBeNull()
  })
})

// EVERY ACTIVE INSTALL'S PROFILE (D1): one card each, tagged with its install, and a save writes
// back to the card's own install with its own fingerprint.
describe('Profile across installs', () => {
  const OC = { id: 'oc', host: 'opencode', scope: 'global', path: '/oc', state: 'active' }
  const CL = {
    id: 'cl',
    host: 'claude',
    scope: 'global',
    path: '/cl',
    state: 'active',
    default: true,
  }
  beforeEach(() => {
    api.installs = vi.fn(async () => ({ installs: [OC, CL] }))
    api.profile.mockImplementation((inst) =>
      Promise.resolve(
        inst?.host === 'opencode'
          ? { ...FILLED, path: '/oc/PROFILE.md', fingerprint: 'oc-fp', text: '# OpenCode me' }
          : { ...FILLED, path: '/cl/PROFILE.md', fingerprint: 'cl-fp', text: '# Claude me' },
      ),
    )
  })
  afterEach(() => {
    delete api.installs
  })

  // A finished job bumps `dataRev`, which refetches the install list: the cards must stay
  // mounted through it, or an unsaved draft would vanish without the discard question.
  it('keeps an open draft across a dataRev refetch', async () => {
    const { rerender } = render(<Profile dataRev={1} />)
    await screen.findByRole('heading', { name: 'OpenCode me' })
    const oc = screen.getByRole('group', { name: 'Profile mode, OpenCode · global' })
    fireEvent.click(oc.querySelectorAll('button')[1])
    fireEvent.change(screen.getByLabelText('Profile markdown'), { target: { value: 'unsaved' } })
    rerender(<Profile dataRev={2} />)
    await waitFor(() => expect(api.installs).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText('Profile markdown').value).toBe('unsaved')
  })

  // The real fetch parses a new body each time, so the refetched rows are NEW objects with the
  // same ids, landing after the file reads that still hold the old rows. A card is matched by its
  // install's id: matched by identity, the list came up empty and took the draft with it.
  it('keeps an open draft when the refetched install rows are new objects', async () => {
    api.installs = vi.fn(async () => ({ installs: [{ ...OC }, { ...CL }] }))
    const { rerender } = render(<Profile dataRev={1} />)
    await screen.findByRole('heading', { name: 'OpenCode me' })
    const oc = screen.getByRole('group', { name: 'Profile mode, OpenCode · global' })
    fireEvent.click(oc.querySelectorAll('button')[1])
    fireEvent.change(screen.getByLabelText('Profile markdown'), { target: { value: 'unsaved' } })
    rerender(<Profile dataRev={2} />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(api.installs).toHaveBeenCalledTimes(2)
    expect(screen.getByLabelText('Profile markdown').value).toBe('unsaved')
  })

  // A refetch that fails caches null for App's "install list unreadable" notice, and null reads as
  // no install at all. The files keep the last good list: falling to the default install would
  // swap every card's key and unmount the draft.
  it('keeps an open draft when the install list refetch fails', async () => {
    api.installs = vi
      .fn()
      .mockResolvedValueOnce({ installs: [OC, CL] })
      .mockRejectedValue(new Error('daemon gone'))
    const { rerender } = render(<Profile dataRev={1} />)
    await screen.findByRole('heading', { name: 'OpenCode me' })
    const oc = screen.getByRole('group', { name: 'Profile mode, OpenCode · global' })
    fireEvent.click(oc.querySelectorAll('button')[1])
    fireEvent.change(screen.getByLabelText('Profile markdown'), { target: { value: 'unsaved' } })
    rerender(<Profile dataRev={2} />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(api.installs).toHaveBeenCalledTimes(2)
    expect(screen.getByLabelText('Profile markdown').value).toBe('unsaved')
    expect(screen.getAllByRole('region')).toHaveLength(2)
  })

  // Every global install answers with the one shared file: one card, tagged shared, no harness.
  it('shows a file two installs share as one card, tagged shared', async () => {
    api.installs = vi.fn(async () => ({
      installs: [
        { ...OC, shared: true },
        { ...CL, shared: true },
      ],
    }))
    api.profile.mockImplementation(() => Promise.resolve({ ...FILLED, path: '/tier/PROFILE.md' }))
    render(<Profile />)
    await screen.findByRole('heading', { name: 'Who I am' })
    expect(screen.getAllByRole('heading', { name: 'Who I am' })).toHaveLength(1)
    expect(screen.getByRole('region').getAttribute('aria-label')).toBe('Profile, shared')
    expect(document.querySelector('.rule-chip').textContent).toBe('shared')
    expect(document.body.textContent).not.toMatch(/claude|opencode/)
  })

  // A project install beside the shared file keeps its own card and its install name.
  it('keeps a project install apart from the shared card', async () => {
    const REPO = { id: 'p', host: 'bob', scope: 'project', path: '/r/repo', state: 'active' }
    api.installs = vi.fn(async () => ({ installs: [{ ...CL, shared: true }, REPO] }))
    api.profile.mockImplementation((inst) =>
      Promise.resolve(
        inst?.host === 'bob'
          ? { ...FILLED, path: '/r/repo/PROFILE.md', text: '# Repo me' }
          : { ...FILLED, path: '/tier/PROFILE.md' },
      ),
    )
    render(<Profile />)
    await screen.findByRole('heading', { name: 'Repo me' })
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Profile, shared',
      'Profile, repo · BOB (IBM)',
    ])
  })

  // An install whose read failed is not folded away: its own card says so.
  it('keeps a card for an install whose first read failed', async () => {
    api.profile.mockImplementation((inst) =>
      inst?.host === 'opencode'
        ? Promise.reject(new Error('unreadable'))
        : Promise.resolve({ ...FILLED, shared: true }),
    )
    render(<Profile />)
    await screen.findByRole('heading', { name: 'Who I am' })
    await waitFor(() => expect(screen.getByText(/unreadable/)).toBeTruthy())
  })

  // `shared` names the one card the shared file got. A failed read is not that card, whatever its
  // row says: it is tagged with its install, and the tag stays on the error it shows.
  it('tags a failed read with its install, not shared', async () => {
    api.installs = vi.fn(async () => ({
      installs: [
        { ...OC, shared: true },
        { ...CL, shared: true },
      ],
    }))
    api.profile.mockImplementation((inst) =>
      inst?.host === 'opencode'
        ? Promise.reject(new Error('unreadable'))
        : Promise.resolve({ ...FILLED, path: '/tier/PROFILE.md' }),
    )
    render(<Profile />)
    await waitFor(() => expect(screen.getByText(/unreadable/)).toBeTruthy())
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Profile, shared',
      'Profile, OpenCode · global',
    ])
    expect(texts('.rule-chip')).toEqual(['shared', 'OpenCode · global'])
  })

  it('shows one card per file, default first, and saves to the card own install', async () => {
    render(<Profile />)
    await screen.findByRole('heading', { name: 'OpenCode me' })
    expect(screen.getByRole('heading', { name: 'Claude me' })).toBeTruthy()
    // Each card is a region named after its install.
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Profile, Claude Code · global',
      'Profile, OpenCode · global',
    ])
    const groups = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))
    expect(groups).toEqual([
      'Profile mode, Claude Code · global',
      'Profile mode, OpenCode · global',
    ])
    const oc = screen.getByRole('group', { name: 'Profile mode, OpenCode · global' })
    fireEvent.click(oc.querySelectorAll('button')[1])
    fireEvent.change(screen.getByLabelText('Profile markdown'), { target: { value: 'mine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.profileSave).toHaveBeenCalledWith(
        { text: 'mine', fingerprint: 'oc-fp' },
        { host: 'opencode', path: '/oc' },
      ),
    )
  })
})
