import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

import ActivityDetail from '../pages/ActivityDetail.jsx'

const okResp = (body) => ({ ok: true, json: () => Promise.resolve(body) })
const errResp = (status) => ({
  ok: false,
  status,
  statusText: 'ERR',
  json: () => Promise.resolve({ error: 'not found' }),
})

// One live session with every panel filled: files, plan, a conversation and a timeline.
const full = () => {
  const now = Date.now() / 1000
  return {
    session: {
      session_id: 's',
      title: 'fix parser',
      cwd: '/repo',
      status: 'busy',
      updated_at: now,
      model: 'opus-4.8',
      agent: 'build',
      phase: 'Editing a.js',
      tokens: 1200,
      cost: 0.05,
      turn_started_at: now - 3,
      files: {
        count: 1,
        additions: 9,
        deletions: 1,
        items: [{ file: 'a.js', additions: 9, deletions: 1 }],
      },
      todos: {
        done: 1,
        total: 2,
        items: [
          { content: 'do x', status: 'completed' },
          { content: 'do y', status: 'pending' },
        ],
      },
    },
    conversation: [
      { role: 'user', text: 'add a toggle' },
      { role: 'assistant', text: 'done — added the switch' },
      { role: 'user', text: 'make it 50/50' },
    ],
    timeline: [
      { kind: 'tool', label: 'Editing a.js', status: 'completed', ms: 1500 },
      { kind: 'text', snippet: 'here is the plan' },
      { kind: 'step', tokens: 140, cost: 0.2 },
    ],
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ActivityDetail page', () => {
  it('renders header + files + plan, the conversation gist by default, and expands to the timeline', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp(full())))
    render(<ActivityDetail sid="s" />)
    expect(await screen.findByText('fix parser')).toBeTruthy()
    expect(screen.getByText('Activity')).toBeTruthy() // back link

    // gist by default
    const txt = document.body.textContent
    expect(txt).toContain('add a toggle') // first ask
    expect(txt).toContain('make it 50/50') // latest ask
    expect(txt).toContain('done — added the switch') // latest reply
    expect(txt).toContain('do y') // uncapped plan
    // full timeline hidden until expanded
    expect(screen.queryByText('here is the plan')).toBeNull()

    // expand → the full step timeline
    screen.getByText(/Show full stream \(5\)/).click()
    expect(await screen.findByText('here is the plan')).toBeTruthy()
    expect(document.body.textContent).toContain('1.5s') // tool duration
    expect(document.body.textContent).toContain('140 tok') // step tokens
  })

  it('shows "Session ended" on a 404', async () => {
    global.fetch = vi.fn(() => Promise.resolve(errResp(404)))
    render(<ActivityDetail sid="s" />)
    expect(await screen.findByText('Session ended')).toBeTruthy()
  })

  // Any other failure before the first answer names the error, not "Loading session…" forever.
  it('shows the error when the first fetch fails with a non-404', async () => {
    global.fetch = vi.fn(() => Promise.resolve(errResp(500)))
    render(<ActivityDetail sid="s" />)
    expect(await screen.findByText('not found')).toBeTruthy()
    expect(screen.queryByText('Loading session…')).toBeNull()
  })

  // AC-12: the session title is the page's only h1; each panel is a level-2 heading.
  it('has one h1, the session title, and an h2 per panel', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp(full())))
    render(<ActivityDetail sid="s" />)
    await screen.findByText('fix parser')
    const names = (level) => screen.queryAllByRole('heading', { level }).map((h) => h.textContent)
    expect(names(1)).toEqual(['fix parser'])
    expect(names(2)).toEqual(['Files touched (1)', 'Plan (1/2)', 'Timeline'])
  })

  // AC-17: the detail header carries the same counters as the card, churn included.
  it('shows the session churn in its header', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp(full())))
    render(<ActivityDetail sid="s" />)
    await screen.findByText('fix parser')
    expect(document.querySelector('.card').textContent).toContain('1 file +9 −1')
  })

  // AC-9: the stream toggle says what it controls and whether that is open.
  it('ties the stream toggle to the region it expands', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp(full())))
    render(<ActivityDetail sid="s" />)
    const btn = await screen.findByRole('button', { name: 'Show full stream (5)' })
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    const region = document.getElementById(btn.getAttribute('aria-controls'))
    expect(region).toBeTruthy()
    btn.click()
    await screen.findByText('here is the plan')
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(region.contains(screen.getByText('here is the plan'))).toBe(true)
  })

  // AC-6: each expanded stream row says when it happened (local clock time).
  it('stamps each stream row with its clock time', async () => {
    const body = full()
    body.timeline = [
      {
        kind: 'tool',
        label: 'Editing a.js',
        status: 'completed',
        t: new Date(2026, 9, 24, 14, 5, 9).getTime(),
      },
    ]
    global.fetch = vi.fn(() => Promise.resolve(okResp(body)))
    render(<ActivityDetail sid="s" />)
    ;(await screen.findByRole('button', { name: /Show full stream/ })).click()
    const time = await screen.findByText('14:05:09')
    expect(time.tagName).toBe('TIME')
  })

  // Guard (green on BASE, kept so it stays true): the only action is the ghost back link.
  it('has no filled (primary) button', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp(full())))
    render(<ActivityDetail sid="s" />)
    await screen.findByText('fix parser')
    expect(document.querySelectorAll('.btn:not(.ghost)').length).toBe(0)
  })

  // VS-20: an ended session is final; polling its 404 every 2 s is wasted round-trips.
  it('stops polling once the session has ended', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    global.fetch = vi.fn(() => Promise.resolve(errResp(404)))
    render(<ActivityDetail sid="s" />)
    await screen.findByText('Session ended')
    const n = global.fetch.mock.calls.length
    await vi.advanceTimersByTimeAsync(6000)
    expect(global.fetch.mock.calls.length).toBe(n)
  })
})
