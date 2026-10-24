import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

import Activity from '../pages/Activity.jsx'
import { compact } from '../lib/activity.jsx'

const okResp = (body) => ({ ok: true, json: () => Promise.resolve(body) })

afterEach(() => {
  vi.restoreAllMocks()
  // The filter persists in the hash: reset it, or one test's chip leaks into the next.
  window.history.replaceState(null, '', '#/activity')
})

describe('compact()', () => {
  it('keeps the forced decimal on a round k value', () => {
    expect(compact(5000)).toBe('5.0k') // round thousands still carry ".0", not bare "5k"
  })

  it('leaves negatives uncompacted', () => {
    expect(compact(-5000)).toBe('-5000') // n<1000 is a signed comparison — negatives fall in, unformatted
  })

  it('keeps the forced decimal on a round M value', () => {
    expect(compact(1000000)).toBe('1.0M') // round millions still carry ".0", not bare "1M"
  })
})

describe('Activity page', () => {
  it('shows the empty state when no sessions are live', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp({ activity: [] })))
    render(<Activity />)
    expect(await screen.findByText('No active sessions')).toBeTruthy()
  })

  it('makes each session card a real link to its detail page', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        okResp({
          activity: [{ session_id: 'ses a', title: 'fix it', status: 'busy', updated_at: 0 }],
        }),
      ),
    )
    render(<Activity />)
    const link = (await screen.findByText('fix it')).closest('a')
    expect(link.getAttribute('href')).toBe('#/activity/ses%20a')
  })

  it('renders a card per session with agent, status label, and cwd fallback', async () => {
    const now = Date.now() / 1000
    global.fetch = vi.fn(() =>
      Promise.resolve(
        okResp({
          activity: [
            {
              session_id: 'ses_a',
              agent: 'reviewer',
              title: 'fix the parser',
              cwd: '/repo/app',
              status: 'busy',
              updated_at: now,
            },
            {
              session_id: 'ses_b',
              agent: null,
              title: null,
              cwd: '/work/other-dir',
              status: 'waiting-input',
              updated_at: now,
            },
          ],
        }),
      ),
    )
    render(<Activity />)
    expect(await screen.findByText('fix the parser')).toBeTruthy()
    expect(screen.getByText('reviewer')).toBeTruthy()
    expect(screen.getByText('working')).toBeTruthy() // busy → "working"
    expect(screen.getByText('your move')).toBeTruthy() // waiting-input → "your move"
    // Scoped to the card: the Project filter now lists the same basename as an option.
    const card = document.querySelector('a[href="#/activity/ses_b"]')
    expect(within(card).getByText('other-dir')).toBeTruthy() // no title → cwd basename
  })

  it('renders the enriched card: phase, model, counters, churn, todo strip', async () => {
    const now = Date.now() / 1000
    global.fetch = vi.fn(() =>
      Promise.resolve(
        okResp({
          enabled: true,
          activity: [
            {
              session_id: 's',
              title: 'fix parser',
              cwd: '/repo/app',
              status: 'busy',
              updated_at: now,
              model: 'opus-4.8',
              phase: 'Editing Activity.jsx',
              agent: 'build',
              tokens: 48200,
              cost: 0.62,
              turn_started_at: now - 5,
              files: { count: 3, additions: 124, deletions: 18, items: [] },
              todos: { done: 3, total: 5, items: [] },
              error: null,
              blocked_on: null,
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
            {
              session_id: 's',
              title: 't',
              cwd: '/r',
              status: 'blocked',
              updated_at: Date.now() / 1000,
              blocked_on: 'bash: rm -rf build/',
              error: null,
            },
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
    // The off state is a card above the strip now, not the whole page: runs and gate asks
    // still show with tracking off.
    expect(await screen.findByText('Live sessions are off')).toBeTruthy()
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

  // AC-5: the server buckets by status and recency, so its order reshuffles on every turn.
  // The page sorts by session id, ascending: OpenCode ids descend with time, so the newest
  // session comes first even when the older one was updated more recently.
  it('orders cards by session id, ascending (newest first), whatever order the server sends', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        okResp({
          activity: [
            { session_id: 'ses_f1dfb49f', title: 'older', status: 'busy', updated_at: 200 },
            { session_id: 'ses_f1df73d7', title: 'newer', status: 'idle', updated_at: 100 },
          ],
        }),
      ),
    )
    render(<Activity />)
    await screen.findByText('older')
    const hrefs = [...document.querySelectorAll('a.act-card')].map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['#/activity/ses_f1df73d7', '#/activity/ses_f1dfb49f'])
  })

  // AC-11: the card link is named by its title and status, not by every word inside it.
  it('names each card link by its title and status', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        okResp({
          activity: [
            { session_id: 's', title: 'fix it', status: 'busy', updated_at: 0, tokens: 1200 },
          ],
        }),
      ),
    )
    render(<Activity />)
    expect(await screen.findByRole('link', { name: 'fix it working' })).toBeTruthy()
  })

  // AC-12: one h1 for the page; each card title is a level-2 heading under it. The
  // tracking card and the three strip cards are h2s too, before the session cards.
  it('has one h1, Activity, and an h2 per card title', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        okResp({ activity: [{ session_id: 's', title: 'fix it', status: 'busy', updated_at: 0 }] }),
      ),
    )
    render(<Activity />)
    await screen.findByText('fix it')
    const names = (level) => screen.queryAllByRole('heading', { level }).map((h) => h.textContent)
    expect(names(1)).toEqual(['Activity'])
    expect(names(2)).toEqual([
      'Live sessions are on',
      'Runs per day · 14 days',
      'Gate asks by rule · 30 days',
      'Waiting on you',
      'fix it',
    ])
  })

  // Guard (green on BASE, kept so it stays true): the list has no filled action; the
  // tracking switch is a secondary control in its own card, and the filters are chips.
  it('has no filled (primary) button', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        okResp({ activity: [{ session_id: 's', title: 'fix it', status: 'busy', updated_at: 0 }] }),
      ),
    )
    render(<Activity />)
    await screen.findByText('fix it')
    expect(document.querySelectorAll('.btn:not(.ghost)').length).toBe(0)
  })
})

// The Today strip and the merged feed. Each URL gets its own body: a run log, a gate ledger
// and the live sessions. Times are relative to the real clock, an hour back, so they stay
// inside today's (or yesterday's, near UTC midnight) group; every assertion reads counts and
// labels, never a local HH:MM, which would move with the machine's time zone.
describe('Activity page: Today strip and feed', () => {
  const nowS = () => Date.now() / 1000
  const utcDays = (n) =>
    Array.from({ length: n }, (_, i) =>
      new Date(Date.now() - (n - 1 - i) * 86400000).toISOString().slice(0, 10),
    )
  const fixture = (activity = { enabled: true, activity: [] }) => {
    const per = new Array(30).fill(0)
    per[29] = 4 // four asks today
    const per2 = new Array(30).fill(0)
    per2[28] = 3 // three yesterday
    const bodies = {
      '/api/activity': activity,
      '/api/jobs': {
        jobs: [
          {
            id: 'j1',
            action: 'build',
            status: 'done',
            started: nowS() - 3600,
            duration: 1.5,
            output: '',
          },
          {
            id: 'j2',
            action: 'install',
            status: 'failed',
            started: nowS() - 3500,
            duration: 0.5,
            output: '',
          },
          {
            id: 'j3',
            action: 'build',
            status: 'done',
            started: nowS() - 3400,
            duration: 1,
            output: '',
          },
        ],
      },
      '/api/gates': {
        days: utcDays(30),
        rules: [
          { rule: 'law-4', n: 4, per_day: per },
          { rule: 'process-1', n: 3, per_day: per2 },
        ],
      },
    }
    return vi.fn((url, opts) =>
      Promise.resolve(
        okResp(opts?.method === 'POST' ? { enabled: !activity.enabled } : bodies[url] || {}),
      ),
    )
  }
  const region = (name) => screen.getByRole('region', { name })

  it('renders the strip totals from the job log and the gate ledger', async () => {
    global.fetch = fixture()
    render(<Activity />)
    await screen.findAllByRole('img', { name: /^Took / })
    expect(within(region('Runs per day · 14 days')).getByText('3')).toBeTruthy()
    const gates = region('Gate asks by rule · 30 days')
    expect(within(gates).getByText('7')).toBeTruthy() // 4 + 3
    expect(within(gates).getByText('law-4')).toBeTruthy()
  })

  it('says "gate asks", never "block", in the strip and the feed', async () => {
    global.fetch = fixture()
    render(<Activity />)
    await screen.findAllByRole('img', { name: /^Took / })
    const text = [
      region('Runs per day · 14 days'),
      region('Gate asks by rule · 30 days'),
      region('Waiting on you'),
      region('Feed'),
    ]
      .map((r) => r.textContent)
      .join(' ')
    expect(text).toContain('gate asks')
    expect(text).not.toMatch(/block/i)
  })

  it('a chip click writes the filter into the hash and hides the gate rows', async () => {
    global.fetch = fixture()
    render(<Activity />)
    await screen.findAllByRole('img', { name: /^Took / })
    expect(within(region('Feed')).getAllByText('asked').length).toBe(2) // today + yesterday
    fireEvent.click(screen.getByRole('button', { name: 'Runs' }))
    expect(window.location.hash).toBe('#/activity?f=runs')
    expect(screen.getByRole('button', { name: 'Runs' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(region('Feed')).queryAllByText('asked')).toEqual([])
    expect(screen.getAllByRole('img', { name: /^Took / }).length).toBe(3)
  })

  it('a preset hash f=gates renders the gate rows only', async () => {
    window.history.replaceState(null, '', '#/activity?f=gates')
    global.fetch = fixture()
    render(<Activity />)
    expect(
      (await within(await screen.findByRole('region', { name: 'Feed' })).findAllByText('asked'))
        .length,
    ).toBe(2)
    expect(screen.queryAllByRole('img', { name: /^Took / })).toEqual([])
  })

  it('disables the Project filter when no session carries a cwd', async () => {
    global.fetch = fixture({
      enabled: true,
      activity: [{ session_id: 's', title: 'fix it', status: 'busy', updated_at: 0 }],
    })
    render(<Activity />)
    await screen.findByText('fix it')
    expect(screen.getByLabelText('Project').disabled).toBe(true)
  })

  it('counts the sessions waiting on you: blocked and waiting-input, not busy', async () => {
    global.fetch = fixture({
      enabled: true,
      activity: [
        { session_id: 'a', title: 'one', status: 'blocked', updated_at: 0 },
        { session_id: 'b', title: 'two', status: 'waiting-input', updated_at: 0 },
        { session_id: 'c', title: 'three', status: 'busy', updated_at: 0 },
      ],
    })
    render(<Activity />)
    await screen.findByText('three')
    expect(within(region('Waiting on you')).getByText('2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Needs you/ }))
    expect(screen.queryByText('three')).toBeNull()
    expect(screen.getByText('one')).toBeTruthy()
  })

  it('off: shows "Live sessions are off", keeps the feed, and the switch still posts', async () => {
    global.fetch = fixture({ enabled: false, activity: [] })
    render(<Activity />)
    expect(await screen.findByText('Live sessions are off')).toBeTruthy()
    await screen.findAllByRole('img', { name: /^Took / })
    screen.getByRole('switch', { name: 'Track live sessions' }).click()
    await vi.waitFor(() => {
      const post = global.fetch.mock.calls.find((c) => c[1]?.method === 'POST')
      expect(post).toBeTruthy()
      expect(JSON.parse(post[1].body)).toEqual({ enabled: true })
    })
  })
})
