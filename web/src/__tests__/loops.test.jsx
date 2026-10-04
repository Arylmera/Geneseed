import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The Loops page over a fixture `/api/loops` payload: the template cards, the ring for the
// selected one with a card per brick, the Bricks tab with its sources, and the Active tab's
// link (its own suite is below). The ring's geometry is lib/loopRing.js's suite; this one pins the page.
vi.mock('../api/index.js', () => ({
  api: { loops: vi.fn(), activeLoops: vi.fn(), setLoopPreset: vi.fn() },
}))

import Loops from '../pages/Loops.jsx'
import { api } from '../api/index.js'
import { clearAsyncCache } from '../hooks/useAsync.js'

const brick = (name, effect, extra = {}) => ({
  name,
  description: `${name} does its step.`,
  effect,
  agent: 'developer',
  skill: null,
  outcomes: ['pass', 'fail'],
  body: `Body of ${name}.`,
  origin: 'shipped',
  available: true,
  reason: null,
  ...extra,
})
const GRAPH = {
  name: 'tiny',
  nodes: ['setup', 'identify', 'apply'],
  start: 'setup',
  edges: [
    { from: 'setup', on: 'pass', to: 'identify' },
    { from: 'identify', on: 'more', to: 'apply' },
    { from: 'identify', on: 'done', to: '$close' },
    { from: 'apply', on: 'pass', to: 'identify' },
  ],
  loops: [{ name: 'iterations', nodes: ['identify', 'apply'], max: 7, iteration: true }],
}
const PAYLOAD = {
  templates: [
    {
      name: 'tiny',
      description: 'The smallest loop.',
      origin: 'shipped',
      graph: { ...GRAPH, rules: ['Cite the proof it is unused.', 'Never retry a flaky test.'] },
    },
    {
      name: 'other',
      description: 'Another.',
      origin: 'project',
      graph: { ...GRAPH, name: 'other' },
    },
  ],
  bricks: [
    brick('apply', 'mutate', { origin: 'project', body: 'Do it our way.' }),
    brick('identify', 'read'),
    brick('lint', 'read', { available: false, reason: 'skill lint is not shipped' }),
    brick('setup', 'read'),
  ],
  overridden: ['apply (project, overrides shipped)'],
}

beforeEach(() => {
  clearAsyncCache()
  api.loops.mockImplementation(() => Promise.resolve(PAYLOAD))
})
afterEach(() => vi.clearAllMocks())

describe('Loops', () => {
  it('lists the templates and draws the first one with a card per brick', async () => {
    render(<Loops tab="templates" />)
    expect(await screen.findByText('The smallest loop.')).toBeTruthy()
    const cards = [...document.querySelectorAll('.loop-tpl b')].map((b) => b.textContent)
    expect(cards).toEqual(['tiny', 'other'])
    expect(document.querySelector('.loop-tpl.on b').textContent).toBe('tiny')
    // The ring: centre text, the gate before apply (its only mutate node), the setup entry.
    const svg = document.querySelector('svg.loop-ring')
    expect(svg.textContent).toContain('iterations · max 7')
    expect(svg.querySelectorAll('.lr-gate')).toHaveLength(1)
    expect(svg.textContent).toContain('setup · 1×')
    // One card per node, in graph order; mutate highlighted; the override said.
    const brickCards = [...document.querySelectorAll('.loop-brick')]
    expect(brickCards.map((c) => c.querySelector('b').textContent)).toEqual([
      'setup',
      'identify',
      'apply',
    ])
    const apply = document.getElementById('brick-apply')
    expect(apply.querySelector('.tag.warn').textContent).toBe('mutate')
    expect(apply.textContent).toContain('overrides shipped')
  })

  it('opens the routed template', async () => {
    render(<Loops tab="templates" item="other" />)
    await screen.findByText('Another.')
    expect(document.querySelector('.loop-tpl.on b').textContent).toBe('other')
  })

  // A template's `rules` (what every brick must do) are listed under its graph, in order; a
  // template with none (`other`) shows no list, and the description is never repeated there.
  it('lists the template rules under the graph, and nothing when there are none', async () => {
    const { unmount } = render(<Loops tab="templates" />)
    await screen.findByText('The smallest loop.')
    const list = screen.getByRole('list', { name: 'Rules every brick follows' })
    expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Cite the proof it is unused.',
      'Never retry a flaky test.',
    ])
    unmount()
    render(<Loops tab="templates" item="other" />)
    await screen.findByText('Another.')
    expect(screen.queryByRole('list', { name: 'Rules every brick follows' })).toBeNull()
  })

  // A `gate: human` brick is marked on the ring — a person badge whose title says when the user
  // is asked, distinct from the engine's ⛨ validate gate — and tagged on its card. spec gates
  // every outcome and is a setup step (the badge rides on its entry label); challenge gates on
  // pass only. Entry badges are drawn before node badges.
  it('marks human-gated bricks on the ring and on their cards', async () => {
    const graph = {
      name: 'gated',
      nodes: ['spec', 'identify', 'apply', 'challenge'],
      start: 'spec',
      edges: [
        { from: 'spec', on: 'pass', to: 'identify' },
        { from: 'identify', on: 'more', to: 'apply' },
        { from: 'identify', on: 'done', to: '$close' },
        { from: 'apply', on: 'pass', to: 'challenge' },
        { from: 'challenge', on: 'pass', to: 'identify' },
      ],
      loops: [
        { name: 'iterations', nodes: ['identify', 'apply', 'challenge'], max: 5, iteration: true },
      ],
    }
    api.loops.mockImplementation(() =>
      Promise.resolve({
        templates: [{ name: 'gated', description: 'Gated loop.', origin: 'shipped', graph }],
        bricks: [
          brick('apply', 'mutate'),
          brick('challenge', 'read', { gate: 'human', gateOn: ['pass'] }),
          brick('identify', 'read'),
          brick('spec', 'mutate', { gate: 'human' }),
        ],
        overridden: [],
      }),
    )
    render(<Loops tab="templates" />)
    await screen.findByText('Gated loop.')
    const svg = document.querySelector('svg.loop-ring')
    expect([...svg.querySelectorAll('.lr-human title')].map((t) => t.textContent)).toEqual([
      'Human gate',
      'Human gate on pass',
    ])
    expect(svg.querySelectorAll('.lr-gate')).toHaveLength(1)
    expect(svg.querySelector('.lr-gate title').textContent).toMatch(/^validate/)
    expect(screen.getByRole('button', { name: 'challenge brick, human gate on pass' })).toBeTruthy()
    const tag = (n) => document.querySelector(`#brick-${n} .tag.human`)?.textContent ?? null
    expect(['spec', 'identify', 'apply', 'challenge'].map(tag)).toEqual([
      'human gate',
      null,
      null,
      'human gate on pass',
    ])
  })

  it('scrolls to the brick card when its node is clicked', async () => {
    render(<Loops tab="templates" />)
    await screen.findByText('The smallest loop.')
    const card = document.getElementById('brick-identify')
    card.scrollIntoView = vi.fn()
    fireEvent.click(screen.getByRole('button', { name: 'identify brick' }))
    expect(card.scrollIntoView).toHaveBeenCalled()
  })

  it('lists every brick with its source, dimming the unavailable one with its reason', async () => {
    render(<Loops tab="bricks" />)
    await screen.findByText('Do it our way.')
    const names = [...document.querySelectorAll('.loop-brick b')].map((b) => b.textContent)
    expect(names).toEqual(['apply', 'identify', 'lint', 'setup'])
    const lint = document.getElementById('brick-lint')
    expect(lint.classList.contains('dimmed')).toBe(true)
    expect(lint.textContent).toContain('Unavailable: skill lint is not shipped')
    expect(document.getElementById('brick-apply').querySelector('pre').textContent).toBe(
      'Do it our way.',
    )
  })

  it('shows Active as a tab link beside Templates and Bricks', async () => {
    render(<Loops tab="templates" />)
    await screen.findByText('The smallest loop.')
    const tabs = [...document.querySelectorAll('nav.tabs a')].map((a) => a.textContent)
    expect(tabs).toEqual(['Templates2', 'Bricks4', 'Active'])
    expect(document.querySelector('nav.tabs .tab-off')).toBeNull()
  })

  // A brick or template the catalogue skipped is named on the page, on both tabs, or a team's
  // broken override would simply be missing with nothing saying why.
  it('names the files the catalogue skipped', async () => {
    api.loops.mockImplementation(() =>
      Promise.resolve({
        ...PAYLOAD,
        problems: ['bricks/broken.md (project): broken: outcomes is empty'],
      }),
    )
    render(<Loops tab="bricks" />)
    const notice = await screen.findByRole('status', { name: /skipped/ })
    expect(notice.textContent).toContain('bricks/broken.md (project): broken: outcomes is empty')
  })

  it('shows no notice when the catalogue is clean', async () => {
    render(<Loops tab="templates" />)
    await screen.findByText('The smallest loop.')
    expect(screen.queryByRole('status', { name: /skipped/ })).toBeNull()
  })

  it('says so when the catalogue cannot be read', async () => {
    api.loops.mockImplementation(() => Promise.reject(new Error('boom')))
    render(<Loops tab="templates" />)
    expect(await screen.findByText(/boom/)).toBeTruthy()
  })

  it('has an empty state with nowhere-to-add advice', async () => {
    api.loops.mockImplementation(() =>
      Promise.resolve({ templates: [], bricks: [], overridden: [] }),
    )
    render(<Loops tab="templates" />)
    expect(await screen.findByText('No templates')).toBeTruthy()
  })
})

// The Active tab over a fixture `/api/loops/active` payload: one card per registered loop,
// read off its LOOP.md. Live rows carry the state; finished and unreadable rows carry only
// their identity and are shown muted. The selected card draws its graph's ring with the node
// the loop stands on highlighted, and the iteration history under it.
const RUN = {
  root: 'C:/w/fix-login',
  branch: 'loop/fix-login',
  title: 'Fix the login bug',
  started: '2026-10-03T08:00:00.000Z',
  status: 'running',
  iteration: 3,
  node: 'apply',
  preset: 'balanced',
  threshold: 5,
  current: { declared: 2 },
  history: [
    {
      iteration: 1,
      bricks: [],
      declared: 2,
      actual: 3,
      decision: 'silent',
      tests: 'pass',
      intent: 'Guard the null user',
    },
    {
      iteration: 2,
      bricks: [],
      declared: 6,
      actual: 6,
      decision: 'soft',
      tests: 'fail',
      intent: 'Rework the session check',
    },
  ],
  review: [],
  reason: null,
  awaiting: null,
  graph: GRAPH,
}
const WAITING = {
  ...RUN,
  root: 'C:/w/refactor',
  branch: 'loop/refactor',
  title: 'Split the parser',
  status: 'awaiting',
  iteration: 1,
  node: 'identify',
  preset: 'prudent',
  history: [],
  awaiting: { kind: 'declared', iteration: 1, score: 7, threshold: 3 },
}
const DONE = {
  root: 'C:/w/old',
  branch: 'loop/old',
  title: 'An old loop',
  started: '2026-10-01T08:00:00.000Z',
  status: 'finished',
}

describe('Loops › Active', () => {
  const show = (loops) => api.activeLoops.mockImplementation(() => Promise.resolve({ loops }))

  // A failed read rejects with an Error object (api/http.js `fail`); the page must show its
  // message, not hand the object to React — a console on an older server (no
  // /api/loops/active yet) crashed the whole page with React error #31 this way.
  it('shows a failed read as its message instead of crashing', async () => {
    api.activeLoops.mockImplementation(() =>
      Promise.reject(new Error('not found: /api/loops/active')),
    )
    render(<Loops tab="active" />)
    expect(await screen.findByText('not found: /api/loops/active')).toBeTruthy()
  })

  it('renders one card per loop with its branch, status, iteration, preset and node', async () => {
    show([RUN, WAITING, DONE])
    render(<Loops tab="active" />)
    await screen.findByText('Fix the login bug')
    const cards = [...document.querySelectorAll('.loop-run')]
    expect(cards.map((c) => c.querySelector('.loop-run-title').textContent)).toEqual([
      'Fix the login bug',
      'Split the parser',
      'An old loop',
    ])
    const run = cards[0]
    expect(run.textContent).toContain('loop/fix-login')
    expect(run.querySelector('.tag.acc').textContent).toBe('running')
    // max is the graph's iteration loop's `max` (7 in GRAPH).
    expect(run.textContent).toContain('iteration 3 / 7')
    expect(run.textContent).toContain('at apply')
    expect(screen.getByLabelText('Preset for Fix the login bug').value).toBe('balanced')
  })

  it('highlights an awaiting loop with what it waits on and where to answer', async () => {
    show([RUN, WAITING])
    render(<Loops tab="active" />)
    await screen.findByText('Split the parser')
    const [run, waiting] = document.querySelectorAll('.loop-run')
    expect(run.classList.contains('awaiting')).toBe(false)
    expect(waiting.classList.contains('awaiting')).toBe(true)
    expect(waiting.querySelector('.tag.warn').textContent).toBe('awaiting')
    expect(waiting.textContent).toContain('Awaiting declared')
    expect(waiting.textContent).toContain("Answer in the agent's session.")
  })

  it('names the brick a human gate waits on', async () => {
    show([{ ...WAITING, awaiting: { kind: 'gate', node: 'adr-draft', outcome: 'pass' } }])
    render(<Loops tab="active" />)
    await screen.findByText('Split the parser')
    const waiting = document.querySelector('.loop-run.awaiting')
    expect(waiting.querySelector('.loop-run-wait').textContent).toBe(
      "Awaiting gate at adr-draft — Answer in the agent's session.",
    )
  })

  it('shows finished and unreadable loops muted, with their status and no picker', async () => {
    show([RUN, DONE, { ...DONE, root: 'C:/w/bad', title: 'Broken', status: 'unreadable' }])
    render(<Loops tab="active" />)
    await screen.findByText('An old loop')
    const [, done, bad] = document.querySelectorAll('.loop-run')
    expect(done.classList.contains('dimmed')).toBe(true)
    expect(done.querySelector('.tag').textContent).toBe('finished')
    expect(done.querySelector('select')).toBeNull()
    expect(bad.classList.contains('dimmed')).toBe(true)
    expect(bad.querySelector('.tag.bad').textContent).toBe('unreadable')
  })

  it('posts a preset change and reads the loops again', async () => {
    show([RUN])
    api.setLoopPreset.mockImplementation(() => Promise.resolve({ ok: true, loop: RUN }))
    render(<Loops tab="active" />)
    const pick = await screen.findByLabelText('Preset for Fix the login bug')
    expect(api.activeLoops).toHaveBeenCalledTimes(1)
    fireEvent.change(pick, { target: { value: 'aggressive' } })
    expect(api.setLoopPreset).toHaveBeenCalledWith('C:/w/fix-login', 'aggressive')
    await waitFor(() => expect(api.activeLoops).toHaveBeenCalledTimes(2))
  })

  it('draws the selected loop with its current node highlighted, and its history', async () => {
    show([RUN, WAITING])
    render(<Loops tab="active" item="C:/w/fix-login" />)
    await screen.findByText('Fix the login bug')
    expect(document.querySelector('.loop-run.on .loop-run-title').textContent).toBe(
      'Fix the login bug',
    )
    const current = document.querySelectorAll('svg.loop-ring .lr-node.current')
    expect([...current].map((n) => n.textContent)).toEqual(['apply'])
    const rows = [...document.querySelectorAll('.loop-history tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent),
    )
    expect(rows).toEqual([
      ['1', 'Guard the null user', '2', '3', 'silent', 'pass'],
      ['2', 'Rework the session check', '6', '6', 'soft', 'fail'],
    ])
  })

  it('selects the first live loop when none is routed', async () => {
    show([DONE, WAITING])
    render(<Loops tab="active" />)
    await screen.findByText('Split the parser')
    expect(document.querySelector('.loop-run.on .loop-run-title').textContent).toBe(
      'Split the parser',
    )
    const current = document.querySelectorAll('svg.loop-ring .lr-node.current')
    expect([...current].map((n) => n.textContent)).toEqual(['identify'])
  })

  it('explains how to start a loop when none is registered', async () => {
    show([])
    render(<Loops tab="active" />)
    expect(await screen.findByText('No loops yet')).toBeTruthy()
    expect(document.querySelector('.empty').textContent).toContain('geneseed loop init')
  })
})
