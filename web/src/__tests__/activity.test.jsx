import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

import Activity from '../pages/Activity.jsx'

const okResp = (body) => ({ ok: true, json: () => Promise.resolve(body) })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Activity page', () => {
  it('shows the empty state when no sessions are live', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp({ activity: [] })))
    render(<Activity />)
    expect(await screen.findByText('No active sessions')).toBeTruthy()
  })

  it('renders a card per session with agent, status label, and cwd fallback', async () => {
    const now = Date.now() / 1000
    global.fetch = vi.fn(() =>
      Promise.resolve(
        okResp({
          activity: [
            { session_id: 'ses_a', agent: 'reviewer', title: 'fix the parser', cwd: '/repo/app', status: 'busy', updated_at: now },
            { session_id: 'ses_b', agent: null, title: null, cwd: '/work/other-dir', status: 'waiting-input', updated_at: now },
          ],
        }),
      ),
    )
    render(<Activity />)
    expect(await screen.findByText('fix the parser')).toBeTruthy()
    expect(screen.getByText('reviewer')).toBeTruthy()
    expect(screen.getByText('working')).toBeTruthy() // busy → "working"
    expect(screen.getByText('your move')).toBeTruthy() // waiting-input → "your move"
    expect(screen.getByText('other-dir')).toBeTruthy() // no title → cwd basename
  })
})
