import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

import ActivityDetail from '../pages/ActivityDetail.jsx'

const okResp = (body) => ({ ok: true, json: () => Promise.resolve(body) })
const errResp = (status) => ({ ok: false, status, statusText: 'ERR', json: () => Promise.resolve({ error: 'not found' }) })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ActivityDetail page', () => {
  it('renders header + files + plan, the conversation gist by default, and expands to the timeline', async () => {
    const now = Date.now() / 1000
    global.fetch = vi.fn(() =>
      Promise.resolve(
        okResp({
          session: {
            session_id: 's', title: 'fix parser', cwd: '/repo', status: 'busy', updated_at: now,
            model: 'opus-4.8', agent: 'build', phase: 'Editing a.js', tokens: 1200, cost: 0.05, turn_started_at: now - 3,
            files: { count: 1, items: [{ file: 'a.js', additions: 9, deletions: 1 }] },
            todos: { done: 1, total: 2, items: [{ content: 'do x', status: 'completed' }, { content: 'do y', status: 'pending' }] },
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
        }),
      ),
    )
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
    screen.getByText(/Show all 3 steps/).click()
    expect(await screen.findByText('here is the plan')).toBeTruthy()
    expect(document.body.textContent).toContain('1.5s') // tool duration
    expect(document.body.textContent).toContain('140 tok') // step tokens
  })

  it('shows "Session ended" on a 404', async () => {
    global.fetch = vi.fn(() => Promise.resolve(errResp(404)))
    render(<ActivityDetail sid="s" />)
    expect(await screen.findByText('Session ended')).toBeTruthy()
  })
})
