import React from 'react'
import { createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

import ActivityDetail from '../pages/ActivityDetail.jsx'
import { padKeys, padLine, TreeSvg } from '../pages/Activity/Bonsai.jsx'

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

  // A garden card links `#/activity/<sid>?host=&path=`: the detail reads THAT install's files.
  it('reads the session from the install its link names', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp(full())))
    window.history.replaceState(null, '', '#/activity/s?host=claude&path=%2Fh%2Fcl')
    try {
      render(<ActivityDetail sid="s?host=claude&path=/h/cl" />)
      expect(await screen.findByText('fix parser')).toBeTruthy()
      expect(global.fetch.mock.calls[0][0]).toBe('/api/activity/s?host=claude&path=%2Fh%2Fcl')
    } finally {
      window.history.replaceState(null, '', '#/')
    }
  })

  it('shows "Session ended" on a 404', async () => {
    global.fetch = vi.fn(() => Promise.resolve(errResp(404)))
    render(<ActivityDetail sid="s" />)
    expect(await screen.findByText('Session ended')).toBeTruthy()
  })

  // A session no longer live (dead, or archived) still answers 200, with `ended: true`: its
  // last snapshot's status ("busy" here) must not read as a session still working.
  it('reads as ended when the server marks the session ended', async () => {
    const d = full()
    d.session.ended = true
    global.fetch = vi.fn(() => Promise.resolve(okResp(d)))
    render(<ActivityDetail sid="s" />)
    await screen.findByText('fix parser')
    const card = document.querySelector('.card')
    expect(within(card).getByText('ended')).toBeTruthy()
    expect(within(card).queryByText('working')).toBeNull()
    // A turn that will never finish has no clock left to run.
    expect(card.querySelector('.act-counters').textContent).toBe('1.2k tok$0.051 file +9 −1')
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

// D7: a session's detail page shows its bonsai, live or ended, from the same drawing as the
// Garden (lib/garden.js + Activity/Bonsai.jsx).
describe('bonsai pads without a mouse', () => {
  const walk = (key, count, pad) => {
    const onPad = vi.fn()
    const preventDefault = vi.fn()
    padKeys({ key, preventDefault }, count, pad, onPad)
    return [onPad.mock.calls, preventDefault.mock.calls.length]
  }
  it('the arrows walk the pads, wrapping at each end, and Escape leaves', () => {
    expect(walk('ArrowRight', 3, null)).toEqual([[[0]], 1])
    expect(walk('ArrowLeft', 3, null)).toEqual([[[2]], 1])
    expect(walk('ArrowDown', 3, 2)).toEqual([[[0]], 1])
    expect(walk('ArrowUp', 3, 0)).toEqual([[[2]], 1])
    expect(walk('Escape', 3, 1)).toEqual([[[null]], 0])
  })
  it('leaves every other key to the page, and a tree with no pad alone', () => {
    expect(walk('Tab', 3, 1)).toEqual([[], 0])
    expect(walk('Enter', 3, 1)).toEqual([[], 0])
    expect(walk('ArrowRight', 0, null)).toEqual([[], 0])
  })
  it('says the pad in words for a live region', () => {
    expect(padLine(null)).toBe('')
    expect(padLine({ key: null, files: [{}] })).toBe('the session: 1 file')
    expect(padLine({ key: 'a', type: 'tester', files: [{}, {}] })).toBe('tester: 2 files')
  })
  it('a tap shows the pad and does not follow the link; a second tap clears it', () => {
    const onPad = vi.fn()
    const t = { runs: [{ p: 0, x: 0, y: 0, w: 1, c: '#000' }], pads: [{ key: null, files: [] }] }
    const ui = (pad) => <TreeSvg t={t} pad={pad} swaying={false} onPad={onPad} px={1} />
    const { container, rerender } = render(ui(null))
    const g = container.querySelector('g')
    expect(fireEvent.touchEnd(g)).toBe(false) // defaultPrevented: no click follows
    expect(onPad).toHaveBeenLastCalledWith(0)
    rerender(ui(0))
    fireEvent.touchEnd(container.querySelector('g'))
    expect(onPad).toHaveBeenLastCalledWith(null)
  })

  const tapped = () => {
    const onPad = vi.fn()
    const t = { runs: [{ p: 0, x: 0, y: 0, w: 1, c: '#000' }], pads: [{ key: null, files: [] }] }
    const { container } = render(<TreeSvg t={t} pad={null} swaying={false} onPad={onPad} px={1} />)
    return [container.querySelector('g'), onPad]
  }
  const at = (y) => ({ clientX: 0, clientY: y })

  // A finger that travelled is a scroll: no pad, and the browser keeps the event.
  it('ignores a touch that moved past the slop, and takes one that stayed inside it', () => {
    const [g, onPad] = tapped()
    fireEvent.touchStart(g, { touches: [at(0)] })
    expect(fireEvent.touchEnd(g, { changedTouches: [at(11)] })).toBe(true)
    expect(onPad).not.toHaveBeenCalled()
    fireEvent.touchStart(g, { touches: [at(0)] })
    expect(fireEvent.touchEnd(g, { changedTouches: [at(10)] })).toBe(false)
    expect(onPad).toHaveBeenCalledWith(0)
  })

  // preventDefault on a non-cancelable event does nothing but warn in the console.
  it('does not cancel a touchend the browser marks non-cancelable', () => {
    const [g, onPad] = tapped()
    const ev = createEvent.touchEnd(g, { cancelable: false })
    ev.preventDefault = vi.fn()
    fireEvent(g, ev)
    expect(ev.preventDefault).not.toHaveBeenCalled()
    expect(onPad).toHaveBeenCalledWith(0)
  })
})

describe('ActivityDetail tree', () => {
  // A v2 session: one sub-agent running, with one file of its own, and one file by the session.
  const v2 = (over = {}) => {
    const body = full()
    Object.assign(body.session, {
      host: 'claude',
      turns: 12,
      context: { used: 50000, window: 200000 },
      compactions: 1,
      context_at_compaction: 180000,
      agents: [{ id: 'a1', type: 'tester', status: 'running' }],
      files_all: [
        { file: 'a.js', path: 'src/a.js', additions: 9, deletions: 1, by: null },
        { file: 'b.test.js', path: 'tests/b.test.js', additions: 4, deletions: 0, by: 'a1' },
      ],
      attribution: null,
      loops: [],
      ...over,
    })
    return body
  }
  const tree = () => document.querySelector('svg.gd-svg')

  it('draws a live session as a labelled image whose running sub-agent sways', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp(v2())))
    render(<ActivityDetail sid="s" />)
    await screen.findByText('fix parser')
    const img = screen.getByRole('img')
    expect(img).toBe(tree())
    expect(img.getAttribute('aria-label')).toBe(
      'Bonsai of this session: 12 turns · context 25 % · 1 compaction · sub-agents: 1 running, 0 finished',
    )
    expect(img.getAttribute('width')).toBe('280') // 56 tree pixels x 5
    expect(document.querySelectorAll('.gd-sway').length).toBe(1)
    expect(document.querySelector('.gd-detail').textContent).not.toContain('ended')
  })

  it('shows a pad’s files, with their path and author, on hover', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp(v2())))
    render(<ActivityDetail sid="s" />)
    await screen.findByText('fix parser')
    fireEvent.mouseEnter(document.querySelector('.gd-sway'))
    const card = document.querySelector('.gd-card')
    expect(card.textContent).toContain('tester · 1 file')
    expect(card.textContent).toContain('tests/b.test.js')
    expect(card.textContent).toContain('+4')
  })

  it('calls for you on a live session that waits, with a bubble and the glow', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp(v2({ status: 'waiting-input' }))))
    render(<ActivityDetail sid="s" />)
    await screen.findByText('fix parser')
    expect(tree().getAttribute('data-bubble')).toBe('!')
    expect(document.querySelector('.gd-needs')).toBeTruthy()
  })

  it('draws an ended session still, without the bubble or the glow, and labels it ended', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(okResp(v2({ status: 'waiting-input', ended: true }))),
    )
    render(<ActivityDetail sid="s" />)
    await screen.findByText('fix parser')
    expect(tree()).toBeTruthy()
    expect(document.querySelectorAll('.gd-sway').length).toBe(0)
    expect(tree().getAttribute('data-bubble')).toBeNull()
    expect(document.querySelector('.gd-needs')).toBeNull()
    expect(tree().getAttribute('aria-label')).toMatch(/^Bonsai of this session, ended: /)
    expect(screen.getByText('ended', { selector: '.gd-detail span' })).toBeTruthy()
  })

  it('draws an ended session that died on an error without the error bubble', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(okResp(v2({ status: 'busy', error: 'boom', ended: true }))),
    )
    render(<ActivityDetail sid="s" />)
    await screen.findByText('fix parser')
    expect(tree().getAttribute('data-bubble')).toBeNull()
    expect(tree().getAttribute('aria-label')).toBe(
      'Bonsai of this session, ended: 12 turns · context 25 % · 1 compaction · sub-agents: 1 unfinished, 0 finished',
    )
  })

  it('draws a minimal tree for a v1 session', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp(full())))
    render(<ActivityDetail sid="s" />)
    await screen.findByText('fix parser')
    expect(tree().querySelectorAll('rect').length).toBeGreaterThan(0)
    expect(tree().getAttribute('aria-label')).toBe(
      'Bonsai of this session: 0 turns · context unknown · 0 compactions · sub-agents: 0 running, 0 finished',
    )
  })

  it('draws a tree, never an error, for garbage v2 fields', async () => {
    const body = v2({
      agents: 'x',
      files_all: [null, 3, { by: 7 }],
      context: 'abc',
      turns: 'many',
      compactions: -2,
      context_at_compaction: {},
    })
    global.fetch = vi.fn(() => Promise.resolve(okResp(body)))
    render(<ActivityDetail sid="s" />)
    await screen.findByText('fix parser')
    expect(tree().querySelectorAll('rect').length).toBeGreaterThan(0)
  })

  it('honours the Garden’s Sakura preference', async () => {
    const fills = () => [...tree().querySelectorAll('rect')].map((r) => r.getAttribute('fill'))
    global.fetch = vi.fn(() => Promise.resolve(okResp(v2())))
    const plain = render(<ActivityDetail sid="s" />)
    await screen.findByText('fix parser')
    const before = fills()
    plain.unmount()
    window.localStorage.setItem('geneseed-garden-sakura', '1')
    try {
      render(<ActivityDetail sid="s" />)
      await screen.findByText('fix parser')
      expect(fills()).not.toEqual(before)
    } finally {
      window.localStorage.removeItem('geneseed-garden-sakura')
    }
  })
})
