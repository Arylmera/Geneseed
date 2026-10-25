import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  // AC-13: the one change a user who looked away needs to hear. A polite live region, there
  // from the first render (a region mounted with its text is not announced), speaks a session
  // only as it ENTERS blocked or your move — never the ones already waiting at load.
  it('announces a session that becomes blocked, and none already waiting at load', async () => {
    const sess = (id, status) => ({
      session_id: id,
      title: id,
      cwd: '/r',
      status,
      updated_at: Date.now() / 1000,
    })
    const polls = [
      [sess('a', 'busy'), sess('b', 'waiting-input')],
      [sess('a', 'blocked'), sess('b', 'waiting-input')],
    ]
    global.fetch = vi.fn((url) =>
      Promise.resolve(
        okResp(
          String(url).endsWith('/api/activity')
            ? { enabled: true, activity: polls.length > 1 ? polls.shift() : polls[0] }
            : {},
        ),
      ),
    )
    const { container } = render(<Activity />)
    const live = container.querySelector('[aria-live="polite"]')
    expect(live).toBeTruthy()
    await screen.findByText('working')
    expect(live.textContent).toBe('')
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    await waitFor(() => expect(live.textContent).toBe('a is blocked'))
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

// Sessions that are no longer live: dead in the directory, or swept into activity/archive/.
// The server sends them newest first in `ended`; the page lists them under the live ones.
describe('Activity page: ended sessions', () => {
  const now = Date.now() / 1000
  const body = (ended) => ({
    enabled: true,
    activity: [{ session_id: 'live1', title: 'still going', status: 'busy', updated_at: now }],
    ended,
  })

  it('lists the ended sessions, newest first, each a link to its detail page', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        okResp(
          body([
            {
              session_id: 'old b',
              title: 'newer one',
              status: 'busy',
              updated_at: now - 60,
              ended: true,
            },
            {
              session_id: 'old_a',
              title: 'older one',
              status: 'idle',
              updated_at: now - 3600,
              ended: true,
            },
          ]),
        ),
      ),
    )
    render(<Activity />)
    const section = (await screen.findByRole('heading', { name: 'Recently ended' })).closest(
      'section',
    )
    const links = within(section).getAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '#/activity/old%20b',
      '#/activity/old_a',
    ])
    expect(within(links[0]).getByText('newer one')).toBeTruthy()
    // An ended session is not "working", whatever status its last snapshot carried.
    expect(within(links[0]).getByText('ended')).toBeTruthy()
    expect(within(links[0]).queryByText('working')).toBeNull()
    // The live card stays outside the ended section.
    expect(within(section).queryByText('still going')).toBeNull()
    expect(screen.getByText('still going')).toBeTruthy()
  })

  it('renders no ended section when `ended` is empty', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp(body([]))))
    render(<Activity />)
    await screen.findByText('still going')
    expect(screen.queryByRole('heading', { name: 'Recently ended' })).toBeNull()
  })

  // History must not push the feed off the page: past five rows the list folds behind a button.
  it('folds a long ended list to five rows behind "Show all"', async () => {
    const six = [1, 2, 3, 4, 5, 6].map((n) => ({
      session_id: `e${n}`,
      title: `gone ${n}`,
      updated_at: now - n * 60,
      ended: true,
    }))
    global.fetch = vi.fn(() => Promise.resolve(okResp(body(six))))
    render(<Activity />)
    const section = (await screen.findByRole('heading', { name: 'Recently ended' })).closest(
      'section',
    )
    expect(within(section).getAllByRole('link')).toHaveLength(5)
    expect(within(section).queryByText('gone 6')).toBeNull()
    fireEvent.click(within(section).getByRole('button', { name: 'Show all 6' }))
    expect(within(section).getAllByRole('link')).toHaveLength(6)
    expect(within(section).getByRole('button', { name: 'Show fewer' })).toBeTruthy()
  })

  const one = [
    { session_id: 'gone1', title: 'finished', host: 'claude', updated_at: now - 60, ended: true },
  ]
  const heading = () => screen.queryByRole('heading', { name: 'Recently ended' })

  // Nothing ended waits on you: the "Needs you" chip hides the section.
  it('hides the ended section under "Needs you"', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp(body(one))))
    render(<Activity />)
    await screen.findByRole('heading', { name: 'Recently ended' })
    fireEvent.click(screen.getByRole('button', { name: 'Needs you' }))
    expect(heading()).toBeNull()
  })

  // Tracking off hides it even if an answer still carries ended sessions.
  it('hides the ended section when tracking is off', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp({ ...body(one), enabled: false })))
    render(<Activity />)
    await screen.findByText('Live sessions are off')
    expect(heading()).toBeNull()
  })

  // The host filter narrows the ended rows like the live ones, and offers their hosts.
  it('narrows the ended rows by host', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp(body(one))))
    render(<Activity />)
    await screen.findByRole('heading', { name: 'Recently ended' })
    const host = screen.getByLabelText('Host')
    expect([...host.options].map((o) => o.value)).toEqual(['', 'claude'])
    fireEvent.change(host, { target: { value: 'claude' } })
    expect(screen.getByText('finished')).toBeTruthy()
  })

  it('drops the ended rows another host owns', async () => {
    window.history.replaceState(null, '', '#/activity?host=opencode')
    global.fetch = vi.fn(() => Promise.resolve(okResp(body(one))))
    render(<Activity />)
    // The live session carries no host either, so the data has landed once this shows.
    await screen.findByText('No active sessions')
    expect(screen.queryByText('finished')).toBeNull()
    expect(heading()).toBeNull()
  })

  it('never lists a session twice: the live copy wins', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        okResp(
          body([{ session_id: 'live1', title: 'still going', updated_at: now - 5, ended: true }]),
        ),
      ),
    )
    render(<Activity />)
    await screen.findByText('still going')
    expect(screen.getAllByText('still going')).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: 'Recently ended' })).toBeNull()
  })
})

describe('Activity garden switch', () => {
  const live = [
    {
      session_id: 'g1',
      host: 'claude',
      title: 'grow it',
      status: 'busy',
      cwd: '/git/app',
      updated_at: 0,
      turns: 12,
      context: { used: 50000, window: 200000 },
      agents: [{ id: 'a1', type: 'developer', status: 'running', started: 0 }],
      files_all: [{ file: 'a.js', path: 'src/a.js', additions: 1, deletions: 0, by: 'a1' }],
    },
    { session_id: 'g2', host: 'bob', title: 'other host', status: 'idle', cwd: '/git/app' },
  ]

  it('switches the live sessions to the garden and keeps it in the hash', async () => {
    window.history.replaceState(null, '', '#/activity?f=needs')
    global.fetch = vi.fn(() => Promise.resolve(okResp({ enabled: true, activity: live })))
    render(<Activity />)
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    fireEvent.click(screen.getByRole('button', { name: 'Garden' }))
    // The list's default is omitted from the hash; the garden is written next to the filters.
    expect(window.location.hash).toBe('#/activity?v=garden')
    const tree = await screen.findByRole('link', { name: /^grow it, claude, working/ })
    expect(tree.getAttribute('href')).toBe('#/activity/g1')
    expect(tree.getAttribute('aria-label')).toMatch(/1 sub-agent running: developer \(1 file\)/)
    expect(tree.querySelector('svg[shape-rendering="crispEdges"] rect')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(window.location.hash).toBe('#/activity')
    expect(await screen.findByText('grow it')).toBeTruthy()
  })

  it('applies the filters to the garden', async () => {
    window.history.replaceState(null, '', '#/activity?v=garden&host=bob')
    global.fetch = vi.fn(() => Promise.resolve(okResp({ enabled: true, activity: live })))
    render(<Activity />)
    expect(await screen.findByRole('link', { name: /^other host, bob, idle/ })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /^grow it/ })).toBeNull()
  })
})
