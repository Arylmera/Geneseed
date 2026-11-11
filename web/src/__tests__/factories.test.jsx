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
// The bugfix loop, small: the catalogue holds it, so its box reads `whole loop`.
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
    // Each stage a labelled block, the human gate badged. The loop stage is a compact box: its
    // loop's name over `whole loop`, the full stage id in its title, and no ring inside it.
    expect(within(g).getByRole('img', { name: 'intake brick' })).toBeTruthy()
    expect(within(g).getByRole('img', { name: 'merge-gate brick, human gate' })).toBeTruthy()
    expect(within(g).getByRole('img', { name: 'loop:bugfix stage, the bugfix loop' })).toBeTruthy()
    const loop = within(g).getByRole('img', { name: 'loop:bugfix stage, the bugfix loop' })
    expect(text('text', loop)).toEqual(['bugfix', 'whole loop'])
    expect(loop.querySelector('title').textContent).toBe('loop:bugfix')
    expect(g.querySelector('foreignObject, .loop-ring')).toBeNull()
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

  // A payload without its `factories` list (an older or broken server) reads as none.
  it('reads a catalogue with no factories list as empty', async () => {
    api.factories.mockImplementation(() => Promise.resolve({ ...CATALOG, factories: undefined }))
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
  // A run is drawn when the route names it (`#/factories/active/<root>`); with no run named, the
  // tab is the board (below).
  it('draws a run with its current stage lit, its child loop node lit and its laps', async () => {
    render(<Factories tab="active" item={ROOT} />)
    await screen.findByText('Fix the login bug', { selector: '.reader-title' })
    expect(document.querySelector('.reader-lede').textContent).toBe(
      'At loop:bugfix · 4 transitions · loop at apply, iteration 2',
    )
    const cur = document.querySelector('.fg-node.current')
    // The child loop's step is said, not only drawn: the block's role hides its text.
    expect(cur.getAttribute('aria-label')).toBe(
      'loop:bugfix stage, the bugfix loop, current stage, at apply',
    )
    expect(cur.getAttribute('aria-current')).toBe('step')
    expect(document.querySelectorAll('.fg-node.current')).toHaveLength(1)
    // The child loop's node is named under the box, not lit in a ring.
    expect(text('text', cur)).toEqual(['bugfix', 'at apply'])
    expect(document.querySelector('.fg-lbl.back').textContent).toBe('↺ ci · 1 / 2')
    expect(text('.fac-cycles li')).toEqual(['ci: loop:bugfix → pr-open → merge-gate — lap 1 of 2'])
  })

  // A run carries its own graph, but no bricks or loops: those come from one install's
  // catalogue, which the run's project may not share. The reader says which catalogue it is.
  it('says which catalogue drew the run', async () => {
    render(<Factories tab="active" item={ROOT} />)
    await screen.findByText('Fix the login bug', { selector: '.reader-title' })
    expect(screen.getByText(/catalogue of the default install/).textContent).toBe(
      'Bricks and loops drawn from the catalogue of the default install, which the run’s project may not share.',
    )
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
    render(<Factories tab="active" item={ROOT} />)
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
    // Under each name: a loop the catalogue holds reads `whole loop`, one it lacks says so (this
    // catalogue holds bugfix alone), and the brick lane reads `no loop`.
    expect(text('.fg-node.lane > text.fg-sub', g)).toEqual([
      'whole loop',
      'not in catalogue',
      'not in catalogue',
      'not in catalogue',
      'no loop',
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
    render(<Factories tab="active" item={ROOT} />)
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

  // The board: with no run named, every run is a card in one of three columns, by what it needs
  // from you. `awaiting` waits for you, and so does a FACTORY.md that cannot be read (no engine
  // action runs until it is repaired); `running` runs; `stopped`, `done` and `finished` (its
  // FACTORY.md gone) have ended. A card says where the run stands, its task, the laps spent
  // against each cycle's max, and the engine's work and waiting time: 13 min is 780000 ms,
  // 1 h 30 min is 5400000 ms, and a time nobody recorded is `unknown`, never 0.
  const at = (hhmm) => `2026-11-11T${hhmm}:00.000Z`
  const run = (name, extra) => ({
    ...RUN,
    root: `C:/work/${name}`,
    title: name,
    loop: null,
    counters: {},
    metrics: { stages: [], workMs: 780000, waitMs: 0, tokens: null, transitions: 2, entries: [] },
    ...extra,
  })
  const HELD = run('held', {
    status: 'awaiting',
    stage: 'merge-gate',
    awaiting: { kind: 'gate', stage: 'merge-gate', outcome: 'none', note: 'C:/tmp/ci.md' },
    counters: { ci: 1 },
    tasks: { path: 'specs/x/spec.md', count: 3, index: 2 },
    history: [
      { stage: 'intake', outcome: 'pass', task: 0, at: at('10:01') },
      { stage: 'loop:bugfix', outcome: 'pass', task: 0, at: at('10:11') },
      { stage: 'pr-open', outcome: 'pass', task: 0, at: at('10:13') },
      { stage: 'merge-gate', outcome: 'fail', task: 0, at: at('10:20') },
      { stage: 'loop:bugfix', outcome: 'pass', task: 0 },
      { stage: 'merge-gate', outcome: 'none', task: 0, at: at('11:00') },
      { stage: 'merge-gate', verdict: 'amend', task: 0, at: at('12:30') },
      { stage: 'merge-gate', outcome: 'none', task: 0, at: at('12:31') },
    ],
    metrics: {
      stages: [],
      workMs: null,
      waitMs: 5400000,
      tokens: 4200,
      transitions: 6,
      entries: [
        { ms: 60000, wait: false, rework: false },
        { ms: 600000, wait: false, rework: false },
        { ms: 120000, wait: false, rework: false },
        { ms: 420000, wait: false, rework: true },
        { ms: null, wait: false, rework: false },
        { ms: null, wait: false, rework: false },
        { ms: 5400000, wait: true, rework: false },
        { ms: 45000, wait: false, rework: false },
      ],
    },
  })
  const BOARD = [
    run('going'),
    HELD,
    run('halted', { status: 'stopped', reason: 'cycle ci exhausted its max of 2' }),
    run('closed', { status: 'done', stage: '$close' }),
    { root: 'C:/work/gone', title: 'gone', factory: factory.name, status: 'finished' },
    { root: 'C:/work/broken', title: 'broken', factory: factory.name, status: 'unreadable' },
  ]
  it('shows every run as a card in three columns, the ones that wait for you first', async () => {
    api.activeFactories.mockImplementation(() => Promise.resolve({ factories: BOARD }))
    render(<Factories tab="active" />)
    const board = await screen.findByRole('region', { name: 'Runs board' })
    expect(text('.fac-col h3', board)).toEqual(['Waits for you 2', 'Running 1', 'Ended 3'])
    const cards = (label) =>
      [...within(board).getByRole('group', { name: label }).querySelectorAll('.fac-card')].map(
        (c) => [c.getAttribute('href'), ...text('b, span', c)],
      )
    expect(cards('Waits for you')).toEqual([
      [
        '#/factories/active/C%3A%2Fwork%2Fheld',
        'held',
        'bug-report-to-fix',
        'Waits at merge-gate (none)',
        'task 2 / 3',
        'laps: ci 1 / 2',
        'work unknown · waited 1 h 30 min',
      ],
      [
        '#/factories/active/C%3A%2Fwork%2Fbroken',
        'broken',
        'bug-report-to-fix',
        'Its FACTORY.md cannot be read.',
      ],
    ])
    expect(cards('Running')).toEqual([
      [
        '#/factories/active/C%3A%2Fwork%2Fgoing',
        'going',
        'bug-report-to-fix',
        'At loop:bugfix',
        'work 13 min · waited 0 s',
      ],
    ])
    expect(cards('Ended').map((c) => c.slice(1))).toEqual([
      [
        'halted',
        'bug-report-to-fix',
        'Stopped: cycle ci exhausted its max of 2',
        'work 13 min · waited 0 s',
      ],
      ['closed', 'bug-report-to-fix', 'Closed', 'work 13 min · waited 0 s'],
      ['gone', 'bug-report-to-fix', 'Its FACTORY.md is gone: the run closed.'],
    ])
    // No run is drawn until one is named.
    expect(document.querySelector('.reader-title')).toBeNull()
  })

  it('says None in a column that holds no run', async () => {
    render(<Factories tab="active" />)
    const board = await screen.findByRole('region', { name: 'Runs board' })
    expect(text('.fac-col h3', board)).toEqual(['Waits for you 0', 'Running 1', 'Ended 0'])
    expect(text('.fac-col > .panel-note', board)).toEqual(['None.', 'None.'])
  })

  // The detail of a held run: the gate's stage, outcome and the PATH of its note (the console
  // never reads the note), then one row per history entry: the outcome or the user's answer, the
  // engine's time to the minute in UTC, the duration (waiting time on an answer), and a rework
  // mark where the engine set one. An entry with no time reads `unknown`.
  it('opens a run on its timeline, with the held gate and its note path', async () => {
    api.activeFactories.mockImplementation(() => Promise.resolve({ factories: BOARD }))
    render(<Factories tab="active" item="C:/work/held" />)
    await screen.findByText('held', { selector: '.reader-title' })
    expect(document.querySelector('.loop-run-wait').textContent).toBe(
      "Awaiting gate at merge-gate (none) — Answer in the agent's session. Its note: C:/tmp/ci.md",
    )
    const table = screen.getByRole('table', { name: 'Run history' })
    expect([...table.querySelectorAll('tbody tr')].map((tr) => text('td', tr))).toEqual([
      ['intake', 'pass ', '2026-11-11 10:01 UTC', '1 min'],
      ['loop:bugfix', 'pass ', '2026-11-11 10:11 UTC', '10 min'],
      ['pr-open', 'pass ', '2026-11-11 10:13 UTC', '2 min'],
      ['merge-gate', 'fail rework', '2026-11-11 10:20 UTC', '7 min'],
      ['loop:bugfix', 'pass ', 'unknown', 'unknown'],
      ['merge-gate', 'none ', '2026-11-11 11:00 UTC', 'unknown'],
      ['merge-gate', 'you answered amend', '2026-11-11 12:30 UTC', '1 h 30 min waiting'],
      ['merge-gate', 'none ', '2026-11-11 12:31 UTC', '45 s'],
    ])
    expect(table.querySelectorAll('.tag.warn')).toHaveLength(1)
    expect(document.querySelector('.fac-totals').textContent).toBe(
      'Work unknown · waited 1 h 30 min · tokens 4200',
    )
    expect(screen.getByRole('link', { name: '← All runs' }).getAttribute('href')).toBe(
      '#/factories/active',
    )
  })

  // FACTORY.md is a file anyone can edit, and the console reads it unvalidated: an `at` that is
  // not a string (a number here) reads `unknown`, as a missing one does, and the page still draws.
  it('reads a time that is not a string as unknown, and still draws the run', async () => {
    const odd = run('odd', {
      history: [{ stage: 'intake', outcome: 'pass', task: 0, at: 5 }],
      metrics: { ...HELD.metrics, entries: [{ ms: null, wait: false, rework: false }] },
    })
    api.activeFactories.mockImplementation(() => Promise.resolve({ factories: [odd] }))
    render(<Factories tab="active" item="C:/work/odd" />)
    await screen.findByText('odd', { selector: '.reader-title' })
    const table = screen.getByRole('table', { name: 'Run history' })
    expect([...table.querySelectorAll('tbody tr')].map((tr) => text('td', tr))).toEqual([
      ['intake', 'pass ', 'unknown', 'unknown'],
    ])
  })

  // A payload without its `factories` list reads as no run, not as a read still out.
  it('reads an active payload with no factories list as no run', async () => {
    api.activeFactories.mockImplementation(() => Promise.resolve({}))
    render(<Factories tab="active" />)
    expect(await screen.findByText('No runs yet')).toBeTruthy()
  })
})
