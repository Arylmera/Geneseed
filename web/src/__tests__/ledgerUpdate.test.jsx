import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The Overview's version chip and its Update button. A git clone can always pull (main moves
// between releases, and a work proxy can leave the npm check unanswered), so it always gets
// Update. An npm install gets it only when a newer release is out.

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

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of ['fleet', 'usage', 'gates', 'rules', 'activity', 'profile', 'catalog']) {
    api[k].mockImplementation(() => Promise.resolve(null))
  }
})

const show = (update) => {
  api.update.mockResolvedValue(update)
  const onAction = vi.fn()
  render(<Ledger overview={null} onAction={onAction} />)
  return onAction
}

describe('Overview Update button', () => {
  it('shows on a git clone even when the release check is unavailable, and runs update', async () => {
    const onAction = show({ current: '4.15.0', latest: null, available: null, git: true })
    await screen.findByText(/update check unavailable/)
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    expect(onAction).toHaveBeenCalledWith('update')
  })

  it('shows on a git clone that is on the latest release', async () => {
    show({ current: '4.15.0', latest: '4.15.0', available: false, git: true })
    await screen.findByText(/latest/)
    expect(screen.getByRole('button', { name: 'Update' })).toBeTruthy()
  })

  it('is absent on an npm install with nothing newer', async () => {
    show({ current: '4.15.0', latest: '4.15.0', available: false, git: false })
    await screen.findByText(/latest/)
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull()
  })

  it('shows on an npm install when a newer release is out', async () => {
    show({ current: '4.15.0', latest: '4.16.0', available: true, git: false })
    await screen.findByText('4.16.0 available')
    expect(screen.getByRole('button', { name: 'Update' })).toBeTruthy()
  })
})
