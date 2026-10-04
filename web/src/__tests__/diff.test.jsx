import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../api/index.js', () => ({ api: { diff: vi.fn() } }))

import Diff from '../pages/Diff.jsx'
import { api } from '../api/index.js'

describe('Diff', () => {
  it('shows the in-sync empty state when nothing has changed', async () => {
    api.diff.mockResolvedValueOnce({ deployed: true, diffable: true, files: [] })
    render(<Diff />)
    await waitFor(() => expect(screen.getByText('In sync')).toBeTruthy())
  })

  it('shows the not-deployed state', async () => {
    api.diff.mockResolvedValueOnce({ deployed: false, files: [] })
    render(<Diff />)
    await waitFor(() => expect(screen.getByText('No deployed harness')).toBeTruthy())
  })

  // A PROJECT install is deployed but has no drift check (diffCollect re-renders global emits
  // only). It used to read "No deployed harness", which was false.
  it('says a deployed install with no drift check is not diffable, not undeployed', async () => {
    api.diff.mockResolvedValueOnce({ deployed: true, diffable: false, files: [] })
    render(<Diff />)
    await waitFor(() => expect(screen.getByText('No drift check for this install')).toBeTruthy())
    expect(screen.queryByText('No deployed harness')).toBeNull()
  })

  it('lists changed files with their status and a line count', async () => {
    api.diff.mockResolvedValueOnce({
      deployed: true,
      diffable: true,
      files: [{ rel: 'AGENT.md', status: 'edited', diff: ['@@ -1 +1 @@', '-a', '+b'] }],
    })
    render(<Diff />)
    await waitFor(() => expect(screen.getByText('AGENT.md')).toBeTruthy())
    expect(screen.getByText('edited')).toBeTruthy()
    expect(screen.getByText('1 edited')).toBeTruthy() // summary badge
  })

  // Export runs as a console job (App's runAction): the page starts it and nothing else.
  // It used to poll api.job itself, in a loop nothing cancelled.
  it('hands the export to the job runner', async () => {
    api.diff.mockResolvedValueOnce({ deployed: true, diffable: true, files: [] })
    const onAction = vi.fn()
    render(<Diff onAction={onAction} />)
    fireEvent.click(await screen.findByText('Export improvements'))
    expect(onAction).toHaveBeenCalledWith('export')
  })
})
