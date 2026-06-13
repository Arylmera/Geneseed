import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../api/index.js', () => ({ api: { diff: vi.fn() } }))

import Diff from '../pages/Diff.jsx'
import { api } from '../api/index.js'

describe('Diff', () => {
  it('shows the in-sync empty state when nothing has changed', async () => {
    api.diff.mockResolvedValueOnce({ deployed: true, files: [] })
    render(<Diff />)
    await waitFor(() => expect(screen.getByText('In sync')).toBeTruthy())
  })

  it('shows the not-deployed state', async () => {
    api.diff.mockResolvedValueOnce({ deployed: false, files: [] })
    render(<Diff />)
    await waitFor(() => expect(screen.getByText('No deployed harness')).toBeTruthy())
  })

  it('lists changed files with their status and a line count', async () => {
    api.diff.mockResolvedValueOnce({
      deployed: true,
      files: [{ rel: 'AGENT.md', status: 'edited', diff: ['@@ -1 +1 @@', '-a', '+b'] }],
    })
    render(<Diff />)
    await waitFor(() => expect(screen.getByText('AGENT.md')).toBeTruthy())
    expect(screen.getByText('edited')).toBeTruthy()
    expect(screen.getByText('1 edited')).toBeTruthy() // summary badge
  })
})
