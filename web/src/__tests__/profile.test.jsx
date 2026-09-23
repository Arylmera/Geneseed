import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
      expect(api.profileSave).toHaveBeenCalledWith({
        text: '# Who I am\n\nA builder, revised.',
        fingerprint: 'f1',
      }),
    )
    // successful save lands back on the rendered view
    await waitFor(() => expect(screen.queryByLabelText('Profile markdown')).toBeNull())
  })

  it('keeps the draft on screen when the save is refused by a newer version', async () => {
    // A refused save reloads to learn the new fingerprint. It used to also replace the
    // textarea with the disk copy — the user's edit vanished without a word.
    api.profileSave.mockImplementationOnce(() =>
      Promise.resolve({ ok: false, detail: 'PROFILE.md changed on disk.' }),
    )
    let calls = 0
    api.profile.mockImplementation(() =>
      Promise.resolve(
        ++calls === 1 ? FILLED : { ...FILLED, fingerprint: 'f9', text: '# Agent wrote this' },
      ),
    )
    render(<Profile />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Who I am' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Profile markdown'), { target: { value: 'my draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.profile).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText(/Your edit is kept/)).toBeTruthy())
    expect(screen.getByLabelText('Profile markdown').value).toBe('my draft')
    // …and the next save carries the NEW fingerprint.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.profileSave).toHaveBeenLastCalledWith({ text: 'my draft', fingerprint: 'f9' }),
    )
  })

  it('opens straight in the editor when the profile is empty', async () => {
    api.profile.mockImplementation(() =>
      Promise.resolve({ exists: false, fingerprint: '', text: '' }),
    )
    render(<Profile />)
    await waitFor(() => expect(screen.getByLabelText('Profile markdown')).toBeTruthy())
  })
})
