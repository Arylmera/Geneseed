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

const FILLED = { exists: true, path: '/x/PROFILE.md', fingerprint: 'f1', text: '# Who I am\n\nA builder.' }

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
      })
    )
    // successful save lands back on the rendered view
    await waitFor(() => expect(screen.queryByLabelText('Profile markdown')).toBeNull())
  })

  it('opens straight in the editor when the profile is empty', async () => {
    api.profile.mockImplementation(() => Promise.resolve({ exists: false, fingerprint: '', text: '' }))
    render(<Profile />)
    await waitFor(() => expect(screen.getByLabelText('Profile markdown')).toBeTruthy())
  })
})
