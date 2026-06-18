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

  it('renders the enriched card: phase, model, counters, churn, todo strip', async () => {
    const now = Date.now() / 1000
    global.fetch = vi.fn(() =>
      Promise.resolve(
        okResp({
          enabled: true,
          activity: [
            {
              session_id: 's', title: 'fix parser', cwd: '/repo/app', status: 'busy', updated_at: now,
              model: 'opus-4.8', phase: 'Editing Activity.jsx', agent: 'build',
              tokens: 48200, cost: 0.62, turn_started_at: now - 5,
              files: { count: 3, additions: 124, deletions: 18, items: [] },
              todos: { done: 3, total: 5, items: [] }, error: null, blocked_on: null,
            },
          ],
        }),
      ),
    )
    render(<Activity />)
    expect(await screen.findByText('Editing Activity.jsx')).toBeTruthy()
    expect(screen.getByText('opus-4.8')).toBeTruthy()
    expect(screen.getByText('build')).toBeTruthy()
    expect(screen.getByText('working')).toBeTruthy()
    const txt = document.body.textContent
    expect(txt).toContain('48.2k tok')
    expect(txt).toContain('$0.62')
    expect(txt).toContain('3 files')
    expect(txt).toContain('plan 3/5')
  })

  it('shows the blocked status and its label', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        okResp({
          enabled: true,
          activity: [
            { session_id: 's', title: 't', cwd: '/r', status: 'blocked', updated_at: Date.now() / 1000, blocked_on: 'bash: rm -rf build/', error: null },
          ],
        }),
      ),
    )
    render(<Activity />)
    expect(await screen.findByText('blocked')).toBeTruthy()
    expect(screen.getByText('bash: rm -rf build/')).toBeTruthy()
  })

  it('reflects the disabled flag with an off state and an unchecked switch', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp({ enabled: false, activity: [] })))
    render(<Activity />)
    expect(await screen.findByText('Activity tracking is off')).toBeTruthy()
    expect(document.querySelector('.sw-toggle').getAttribute('aria-checked')).toBe('false')
  })

  it('posts the new state when the switch is clicked', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp({ enabled: true, activity: [] })))
    render(<Activity />)
    await screen.findByText('No active sessions') // enabled + empty
    document.querySelector('.sw-toggle').click()
    await vi.waitFor(() => {
      const post = global.fetch.mock.calls.find((c) => c[1]?.method === 'POST')
      expect(post).toBeTruthy()
      expect(post[0]).toBe('/api/activity')
      expect(JSON.parse(post[1].body)).toEqual({ enabled: false })
    })
  })
})
