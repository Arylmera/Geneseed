import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import factory from './fixtures/bug-report-to-fix.json'
import forked from './fixtures/issue-to-pr-forks.json'

// The Factories page over fixture `/api/factories/catalog` and `/api/factories/active` payloads:
// the rail with its two sections and counts, the list, the reader drawing the factory as its
// graph, and a live run with its current stage lit. The geometry is factoryFlow.test.js's.
vi.mock('../api/index.js', () => ({
  api: { factories: vi.fn(), activeFactories: vi.fn() },
}))

import Factories from '../pages/Factories.jsx'
import { api } from '../api/index.js'
import { clearAsyncCache } from '../hooks/useAsync.js'

const brick = (name, extra = {}) => ({
  name,
  description: `${name} does its step.`,
  effect: 'read',
  agent: 'developer',
  outcomes: ['pass', 'fail'],
  origin: 'shipped',
  available: true,
  reason: null,
  ...extra,
})
// The bugfix ring, small: enough for the loop block to draw a RingGraph.
const BUGFIX = {
  name: 'bugfix',
  nodes: ['reproduce', 'apply'],
  start: 'reproduce',
  edges: [
    { from: 'reproduce', on: 'pass', to: 'apply' },
    { from: 'apply', on: 'pass', to: 'reproduce' },
    { from: 'reproduce', on: 'done', to: '$close' },
  ],
  loops: [{ name: 'iterations', nodes: ['reproduce', 'apply'], max: 5, iteration: true }],
}
const { description, ...graph } = factory
const CATALOG = {
  factories: [{ name: factory.name, description, origin: 'shipped', factory: graph }],
  bricks: [
    brick('apply', { effect: 'mutate' }),
    brick('intake'),
    brick('merge-gate', { outcomes: ['pass', 'fail', 'none'], gate: 'human' }),
    brick('pr-open'),
    brick('reproduce'),
    brick('retro', { outcomes: ['pass'] }),
  ],
  loops: [{ name: 'bugfix', origin: 'shipped', graph: BUGFIX }],
  problems: [],
}
const ROOT = 'C:/work/fix-login'
const RUN = {
  root: ROOT,
  branch: 'loop/factory-fix-login',
  factory: factory.name,
  title: 'Fix the login bug',
  started: '2026-11-08T09:00:00.000Z',
  status: 'running',
  stage: 'loop:bugfix',
  awaiting: null,
  reason: null,
  transitions: 4,
  counters: { ci: 1 },
  lane: null,
  tasks: null,
  history: [],
  graph: factory,
  loop: {
    title: 'Fix the login bug',
    status: 'running',
    node: 'apply',
    iteration: 2,
    graph: BUGFIX,
  },
}

beforeEach(() => {
  clearAsyncCache()
  api.factories.mockImplementation(() => Promise.resolve(CATALOG))
  api.activeFactories.mockImplementation(() => Promise.resolve({ factories: [RUN] }))
})
afterEach(() => vi.clearAllMocks())

const text = (sel, root = document) => [...root.querySelectorAll(sel)].map((e) => e.textContent)

describe('Factories — templates', () => {
  it('lists the two sections with their counts, and draws the factory as its graph', async () => {
    render(<Factories tab="templates" />)
    await screen.findByText(description, { selector: '.reader-lede' })
    const rail = screen.getByRole('complementary', { name: 'Factories sections' })
    expect(rail.querySelector('h1').textContent).toBe('Factories')
    await waitFor(() => expect(text('.kind-list a', rail)).toEqual(['Templates1', 'Active1']))
    // The panes sit in the `lib` size container the narrow tier queries (narrowPanes.test.js).
    expect(rail.closest('.lib-wrap > .library')).not.toBeNull()
    const g = screen.getByRole('group', {
      name: 'bug-report-to-fix factory: intake, loop:bugfix, pr-open, merge-gate, retro',
    })
    // Each stage a labelled block, the loop block holding its ring, the human gate badged.
    expect(within(g).getByRole('img', { name: 'intake brick' })).toBeTruthy()
    expect(within(g).getByRole('img', { name: 'merge-gate brick, human gate' })).toBeTruthy()
    expect(within(g).getByRole('img', { name: 'loop:bugfix stage, the bugfix loop' })).toBeTruthy()
    expect(within(g).getByRole('group', { name: 'bugfix loop: reproduce, apply' })).toBeTruthy()
    expect(g.querySelectorAll('.fg-close, .fg-stop')).toHaveLength(2)
    // The route back wears its cycle and max; the cycle is said in words under the graph.
    expect(g.querySelector('.fg-lbl.back').textContent).toBe('↺ ci · max 2')
    // The legend names the five marks; no lane, so no folded lane stops.
    expect(text('.fg-legend li')).toEqual([
      'brick',
      'whole loop (test · fix · verify)',
      'fork',
      'route back, bounded by its max',
      'fail → stop',
    ])
    expect(text('.fac-cycles li')).toEqual([
      'ci: loop:bugfix → pr-open → merge-gate — 2 laps at most',
    ])
    // Asking the agent comes first; the manual path is ONE `&&` chain, worktree before `init`,
    // so a paste with its placeholders unfilled fails before `init` runs in this checkout.
    const ask = 'Run the bug-report-to-fix factory on <issue URL, file or request>'
    const chain = [
      'git worktree add ../<repo>-factory-<slug> -b loop/factory-<slug>',
      'cd ../<repo>-factory-<slug>',
      'geneseed factory init --factory bug-report-to-fix --title "<title>" --requirement "<requirement>" --input "<issue URL, file path or pasted text>"',
    ].join(' && ')
    expect(text('.loop-start pre')).toEqual([ask, chain])
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    try {
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy request' })))
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy command' })))
    } finally {
      delete navigator.clipboard
    }
    expect(writeText.mock.calls).toEqual([[ask], [chain]])
  })

  it('says so when the catalogue holds no factory', async () => {
    api.factories.mockImplementation(() => Promise.resolve({ ...CATALOG, factories: [] }))
    render(<Factories tab="templates" />)
    expect(await screen.findByText('No factories')).toBeTruthy()
  })

  it('shows the read error rather than a blank page', async () => {
    api.factories.mockImplementation(() =>
      Promise.reject(new Error('not found: /api/factories/catalog')),
    )
    render(<Factories tab="templates" />)
    expect(await screen.findByText('not found: /api/factories/catalog')).toBeTruthy()
  })
})

describe('Factories — active', () => {
  it('draws a run with its current stage lit, its child loop node lit and its laps', async () => {
    render(<Factories tab="active" />)
    await screen.findByText('Fix the login bug', { selector: '.reader-title' })
    expect(document.querySelector('.reader-lede').textContent).toBe(
      'At loop:bugfix · 4 transitions · loop at apply, iteration 2',
    )
    const cur = document.querySelector('.fg-node.current')
    expect(cur.getAttribute('aria-label')).toBe('loop:bugfix stage, the bugfix loop, current stage')
    expect(cur.getAttribute('aria-current')).toBe('step')
    expect(document.querySelectorAll('.fg-node.current')).toHaveLength(1)
    expect(document.querySelector('.lr-node.current').getAttribute('aria-label')).toBe(
      'apply brick, current step',
    )
    expect(document.querySelector('.fg-lbl.back').textContent).toBe('↺ ci · 1 / 2')
    expect(text('.fac-cycles li')).toEqual(['ci: loop:bugfix → pr-open → merge-gate — lap 1 of 2'])
  })

  // A run of the forked factory past its fork: the run's `lane` is taken (it wins over a history
  // that names another lane), the stage it stands on is current, and the two routes back read
  // their laps.
  const FORKED_RUN = {
    ...RUN,
    factory: forked.name,
    stage: 'holdout',
    counters: { holdout: 1 },
    graph: forked,
    loop: null,
    lane: 'loop:feature',
    history: [
      { stage: 'intake', outcome: 'pass' },
      { stage: 'holdout-write', outcome: 'pass' },
      { stage: 'triage', outcome: 'bug' },
      { stage: 'loop:bugfix', outcome: 'pass' },
    ],
  }
  it('lights the lane a forked run took and the stage it stands on', async () => {
    api.activeFactories.mockImplementation(() => Promise.resolve({ factories: [FORKED_RUN] }))
    render(<Factories tab="active" />)
    await screen.findByText('Fix the login bug', { selector: '.reader-title' })
    const g = screen.getByRole('group', { name: /^issue-to-pr factory/ })
    expect(g.querySelector('.fg-node.taken').getAttribute('aria-label')).toBe(
      'loop:feature stage, the feature loop, the lane taken',
    )
    expect(g.querySelector('.fg-node.current').getAttribute('aria-label')).toBe(
      'holdout brick, current stage',
    )
    expect(within(g).getByRole('img', { name: 'triage fork' })).toBeTruthy()
    // Five lane boxes, named without the `loop:` prefix; the fork's outcomes on its lane edges.
    expect(g.querySelectorAll('.fg-node.lane')).toHaveLength(5)
    expect(text('.fg-node.lane > text:not(.fg-sub)', g)).toEqual([
      'bugfix',
      'feature',
      'deps-upgrade',
      'refactor',
      'docs-update',
    ])
    expect(text('.fg-lbl.fork', g)).toEqual(['bug', 'feature', 'deps', 'refactor', 'docs'])
    expect(text('.fg-lbl.back', g)).toEqual(['↺ holdout · 1 / 2', '↺ ci · 0 / 2'])
    // The taken lane's edges in and out are lit.
    expect(g.querySelectorAll('.fg-edge.taken')).toHaveLength(2)
    // Every lane's stop edge is drawn as a tag under its box; no legend line stands in for them.
    expect(text('.fg-tag.stop', g)).toEqual(Array(4).fill('fail → stop'))
    expect(text('.fg-legend li')).toHaveLength(5)
  })

  // A run row from before the engine wrote `lane` has none: its history names the lane.
  it('falls back to the history when the run carries no lane', async () => {
    api.activeFactories.mockImplementation(() =>
      Promise.resolve({ factories: [{ ...FORKED_RUN, lane: undefined }] }),
    )
    render(<Factories tab="active" />)
    await screen.findByText('Fix the login bug', { selector: '.reader-title' })
    expect(document.querySelector('.fg-node.taken').getAttribute('aria-label')).toBe(
      'loop:bugfix stage, the bugfix loop, the lane taken',
    )
  })

  it('says so when no run is registered', async () => {
    api.activeFactories.mockImplementation(() => Promise.resolve({ factories: [] }))
    render(<Factories tab="active" />)
    expect(await screen.findByText('No runs yet')).toBeTruthy()
  })
})
