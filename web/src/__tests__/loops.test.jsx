import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The Loops page in the Library's three panes, over fixture `/api/loops` and
// `/api/loops/active` payloads: the rail of sections with their counts, each section's list —
// filtered, grouped, pilled — and the reader for the selected entry. The ring's geometry is
// lib/loopRing.js's suite; this one pins the page.
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
const tpl = (name, description, category, extra = {}) => ({
  name,
  description,
  origin: 'shipped',
  graph: { ...GRAPH, name, ...(category ? { category } : {}), ...extra },
})
// Five templates, sorted by name as the endpoint sends them: two in development, one in tests,
// one in architecture, one with no category. `gated` runs `review`, a human-gated brick.
const PAYLOAD = {
  templates: [
    tpl('adr', 'Record a decision.', 'architecture'),
    tpl('gated', 'Stops for you.', 'development', {
      nodes: ['setup', 'identify', 'apply', 'review'],
      edges: [
        ...GRAPH.edges.slice(0, 3),
        { from: 'apply', on: 'pass', to: 'review' },
        { from: 'review', on: 'pass', to: 'identify' },
      ],
      loops: [
        { name: 'iterations', nodes: ['identify', 'apply', 'review'], max: 7, iteration: true },
      ],
    }),
    tpl('loose', 'No shelf.', undefined),
    tpl('other', 'Another.', 'tests'),
    tpl('tiny', 'The smallest loop.', 'development', {
      rules: ['Cite the proof it is unused.', 'Never retry a flaky test.'],
    }),
  ],
  bricks: [
    brick('apply', 'mutate', { origin: 'project', body: 'Do it our way.' }),
    brick('identify', 'read'),
    brick('lint', 'read', { available: false, reason: 'skill lint is not shipped' }),
    brick('review', 'read', { origin: 'global', gate: 'human', gateOn: ['pass'] }),
    brick('setup', 'read'),
  ],
  overridden: ['apply (project, overrides shipped)'],
}

beforeEach(() => {
  clearAsyncCache()
  api.loops.mockImplementation(() => Promise.resolve(PAYLOAD))
  api.activeLoops.mockImplementation(() => Promise.resolve({ loops: [] }))
})
afterEach(() => vi.clearAllMocks())

const text = (sel, root = document) => [...root.querySelectorAll(sel)].map((e) => e.textContent)
// The list pane in reading order: a heading as `# Heading`, a row as its name.
const listed = () =>
  [...document.querySelectorAll('.lib-rows .lib-group, .lib-rows .lib-row')].map((e) =>
    e.classList.contains('lib-group')
      ? `# ${e.textContent}`
      : e.querySelector('.lr-name').firstChild.textContent,
  )
const reader = () => document.querySelector('.lib-reader')

describe('Loops — the rail', () => {
  // The Library's rail: the page title and its line, then one link per section with its count.
  // Active counts the registered runs (none here); the routed section is the current one, and
  // the old tab strip is gone.
  it('names the page and lists its three sections with their counts', async () => {
    render(<Loops tab="templates" />)
    await screen.findByText('The smallest loop.')
    const rail = screen.getByRole('complementary', { name: 'Loops sections' })
    expect(rail.querySelector('h1').textContent).toBe('Loops')
    expect(rail.textContent).toContain('What the engine runs')
    await waitFor(() =>
      expect(text('.kind-list a', rail)).toEqual(['Templates5', 'Bricks5', 'Active0']),
    )
    expect(rail.querySelector('a[aria-current="page"]').getAttribute('href')).toBe(
      '#/loops/templates',
    )
    expect(document.querySelector('nav.tabs')).toBeNull()
  })
})

// The selected section's groups nest under it in the rail (components/RailCats.jsx): All, then
// each group present with its count, in list order. Picking one narrows the list to it (its
// heading stays), the filter narrows within it, and moving to another section resets to All.
describe('Loops — categories in the rail', () => {
  const cats = () =>
    [...document.querySelectorAll('.rail-cats button')].map((b) =>
      [...b.querySelectorAll('span:not(.cdot)')].map((x) => x.textContent).join(' '),
    )

  it('nests the template categories under Templates only, after its link', async () => {
    render(<Loops tab="templates" />)
    await screen.findByText('Record a decision.', { selector: '.reader-lede' })
    expect(cats()).toEqual(['All 5', 'Architecture 1', 'Tests 1', 'Development 2', 'Other 1'])
    const nav = screen.getByRole('navigation', { name: 'Sections' })
    expect(nav.querySelectorAll('.rail-cats').length).toBe(1)
    expect(nav.querySelector('a[aria-current="page"]').nextElementSibling).toBe(
      screen.getByRole('list', { name: 'Categories' }).parentElement,
    )
    // One bar segment per category, grown by its count.
    expect(text('.rail-cats .rail-mix span').length).toBe(4)
    expect([...document.querySelectorAll('.rail-mix span')].map((s) => s.style.flexGrow)).toEqual([
      '1',
      '1',
      '2',
      '1',
    ])
  })

  it('narrows to the picked category, combines with the filter, and All restores', async () => {
    render(<Loops tab="templates" />)
    await screen.findByText('Record a decision.', { selector: '.reader-lede' })
    fireEvent.click(screen.getByRole('button', { name: /^Development/ }))
    expect(screen.getByRole('button', { name: /^Development/ }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(listed()).toEqual(['# Development', 'gated', 'tiny'])
    fireEvent.change(screen.getByLabelText('Filter Templates'), { target: { value: 'tiny' } })
    expect(listed()).toEqual(['# Development', 'tiny'])
    fireEvent.change(screen.getByLabelText('Filter Templates'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /^All/ }))
    expect(listed().length).toBe(9)
  })

  it('shows the brick origins under Bricks, and resets on the way back', async () => {
    const { rerender } = render(<Loops tab="templates" />)
    await screen.findByText('Record a decision.', { selector: '.reader-lede' })
    fireEvent.click(screen.getByRole('button', { name: /^Tests/ }))
    rerender(<Loops tab="bricks" />)
    await screen.findByText('Do it our way.')
    expect(cats()).toEqual(['All 5', 'Project 1', 'Global 1', 'Shipped 3'])
    expect(screen.getByRole('list', { name: 'Origins' })).toBeTruthy()
    rerender(<Loops tab="templates" />)
    await waitFor(() => expect(listed().length).toBe(9))
    expect(screen.getByRole('button', { name: /^All/ }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('Loops — templates', () => {
  // Grouped by category in shelf order (architecture, tests, development, refactoring,
  // day-to-day — an empty shelf prints no heading), then Other for a template without one; by
  // name within a shelf. The first row is the one on display when none is routed.
  it('groups the templates by category, Other last, and opens the first', async () => {
    render(<Loops tab="templates" />)
    await screen.findByText('Record a decision.', { selector: '.reader-lede' })
    expect(listed()).toEqual([
      '# Architecture',
      'adr',
      '# Tests',
      'other',
      '# Development',
      'gated',
      'tiny',
      '# Other',
      'loose',
    ])
    expect(document.querySelector('.lib-row.on').getAttribute('href')).toBe('#/loops/templates/adr')
    expect(reader().querySelector('.reader-title').textContent).toBe('adr')
  })

  // A template running any `gate: human` brick wears the pill; the rest wear none.
  it('pills a template that stops for a human', async () => {
    render(<Loops tab="templates" />)
    await screen.findByText('Stops for you.')
    const pill = (n) =>
      document.querySelector(`a[href="#/loops/templates/${n}"] .tag.human`)?.textContent ?? null
    expect(['adr', 'gated', 'tiny'].map(pill)).toEqual([null, 'human gate', null])
  })

  // Substring over name and description, any case; headings follow the rows that survive.
  it('filters by name or description', async () => {
    render(<Loops tab="templates" />)
    await screen.findByText('The smallest loop.')
    const box = screen.getByLabelText('Filter Templates')
    fireEvent.change(box, { target: { value: 'SMALL' } })
    expect(listed()).toEqual(['# Development', 'tiny'])
    expect(document.querySelector('.lib-list-head').textContent).toBe('Templates 1 of 5')
    fireEvent.change(box, { target: { value: 'oth' } })
    expect(listed()).toEqual(['# Tests', 'other'])
    fireEvent.change(box, { target: { value: 'zzz' } })
    expect(screen.getByText('No matches')).toBeTruthy()
  })

  // The reader: name, description, the ring (centre text, the ⛨ gate before apply — its only
  // mutate node — and the setup entry), the rules, then one compact row per brick in graph
  // order: mutate as the warn tag, who runs it, its outcomes, the override.
  it('shows the routed template: ring, rules, then its bricks as rows', async () => {
    render(<Loops tab="templates" item="tiny" />)
    await screen.findByText('Cite the proof it is unused.')
    expect(document.querySelector('.lib-row.on').getAttribute('href')).toBe(
      '#/loops/templates/tiny',
    )
    expect(reader().querySelector('.reader-title').textContent).toBe('tiny')
    expect(reader().querySelector('.reader-lede').textContent).toBe('The smallest loop.')
    const svg = reader().querySelector('svg.loop-ring')
    expect(svg.textContent).toContain('iterations · max 7')
    expect(svg.querySelectorAll('.lr-gate')).toHaveLength(1)
    expect(svg.textContent).toContain('setup · 1×')
    const rules = screen.getByRole('list', { name: 'Rules every brick follows' })
    expect(text('li', rules)).toEqual(['Cite the proof it is unused.', 'Never retry a flaky test.'])
    const rows = screen.getByRole('list', { name: 'Bricks in tiny' })
    expect(text('li > b', rows)).toEqual(['setup', 'identify', 'apply'])
    const apply = document.getElementById('brick-apply')
    expect(apply.querySelector('.tag.warn').textContent).toBe('mutate')
    expect(apply.textContent).toContain('developer')
    expect(apply.textContent).toContain('pass · fail')
    expect(apply.querySelector('.tag.acc').textContent).toBe('overrides shipped')
  })

  it('shows no rules list for a template without rules', async () => {
    render(<Loops tab="templates" item="other" />)
    await screen.findByText('Another.', { selector: '.reader-lede' })
    expect(screen.queryByRole('list', { name: 'Rules every brick follows' })).toBeNull()
  })

  // A `gate: human` brick is marked on the ring — a person badge whose title says when the user
  // is asked, distinct from the engine's ⛨ validate gate — and tagged on its row.
  it('marks a human-gated brick on the ring and on its row', async () => {
    render(<Loops tab="templates" item="gated" />)
    await screen.findByText('Stops for you.', { selector: '.reader-lede' })
    const svg = reader().querySelector('svg.loop-ring')
    expect(text('.lr-human title', svg)).toEqual(['Human gate on pass'])
    expect(svg.querySelector('.lr-gate title').textContent).toMatch(/^validate/)
    expect(screen.getByRole('button', { name: 'review brick, human gate on pass' })).toBeTruthy()
    const tag = (n) => document.querySelector(`#brick-${n} .tag.human`)?.textContent ?? null
    expect(['setup', 'identify', 'apply', 'review'].map(tag)).toEqual([
      null,
      null,
      null,
      'human gate on pass',
    ])
  })

  // Clicking a ring node (or Enter on it) scrolls its row into view and lights it, one at a time.
  it('scrolls to and highlights the brick row when its node is picked', async () => {
    render(<Loops tab="templates" item="tiny" />)
    await screen.findByText('The smallest loop.', { selector: '.reader-lede' })
    const row = document.getElementById('brick-identify')
    row.scrollIntoView = vi.fn()
    fireEvent.click(screen.getByRole('button', { name: 'identify brick' }))
    expect(row.scrollIntoView).toHaveBeenCalled()
    expect(text('.loop-brick.on > b')).toEqual(['identify'])
    fireEvent.keyDown(screen.getByRole('button', { name: 'apply brick' }), { key: 'Enter' })
    expect(text('.loop-brick.on > b')).toEqual(['apply'])
  })

  // The list is keyboard-walkable like the Library's: arrows move focus between row links.
  it('walks the rows with the arrow keys', async () => {
    render(<Loops tab="templates" />)
    await screen.findByText('Record a decision.', { selector: '.reader-lede' })
    const links = [...document.querySelectorAll('.lib-row')]
    links[0].focus()
    fireEvent.keyDown(links[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(links[1])
    fireEvent.keyDown(links[1], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(links[0])
  })

  it('has an empty state with where-to-add advice', async () => {
    api.loops.mockImplementation(() =>
      Promise.resolve({ templates: [], bricks: [], overridden: [] }),
    )
    render(<Loops tab="templates" />)
    expect(await screen.findByText('No templates')).toBeTruthy()
  })
})

describe('Loops — bricks', () => {
  // Grouped by origin — project, global, shipped — by name within each; pills for mutate, a
  // human gate, an override, and an unavailable brick.
  it('groups the bricks by origin with their pills', async () => {
    render(<Loops tab="bricks" />)
    await screen.findByText('Do it our way.')
    expect(listed()).toEqual([
      '# Project',
      'apply',
      '# Global',
      'review',
      '# Shipped',
      'identify',
      'lint',
      'setup',
    ])
    const pills = (n) => text(`a[href="#/loops/bricks/${n}"] .tag`)
    expect(pills('apply')).toEqual(['mutate', 'overrides shipped'])
    expect(pills('review')).toEqual(['human gate'])
    expect(pills('lint')).toEqual(['unavailable'])
    expect(pills('identify')).toEqual([])
  })

  // The reader: the frontmatter facts — outcomes as one pill each, availability with the reason
  // an unavailable brick cannot run — then its body rendered, not raw.
  it('shows a brick’s facts, why it is unavailable, and its rendered body', async () => {
    render(<Loops tab="bricks" item="lint" />)
    await screen.findByText('Body of lint.')
    expect(reader().querySelector('.reader-title').textContent).toBe('lint')
    const facts = [...reader().querySelectorAll('.loop-facts dt')].map((dt) => [
      dt.textContent,
      dt.nextElementSibling.textContent,
    ])
    expect(facts).toEqual([
      ['effect', 'read'],
      ['agent', 'developer'],
      ['outcomes', 'passfail'],
      ['gate', 'none'],
      ['origin', 'shipped'],
      ['available', 'no — skill lint is not shipped'],
    ])
    expect(text('.loop-facts dd .tag', reader())).toEqual(['read', 'pass', 'fail'])
    expect(reader().querySelector('.markdown p').textContent).toBe('Body of lint.')
    expect(reader().querySelector('pre.loop-brick-src')).toBeNull()
  })

  // The body is markdown: blank lines split paragraphs, backticks become <code>, a dash list a
  // list, stars emphasis — the user's example brick, with a Maven command and an Awaitility call.
  it('renders the body as markdown: paragraphs, inline code, lists, emphasis', async () => {
    const body = [
      'Run `mvn test -Dtest=<Class>#<method>` first.',
      '',
      'Never sleep — use `await().atMost(…).until(…)`, *always*.',
      '',
      '- one',
      '- two',
    ].join('\n')
    api.loops.mockImplementation(() =>
      Promise.resolve({ ...PAYLOAD, bricks: [brick('flaky', 'mutate', { body })] }),
    )
    render(<Loops tab="bricks" item="flaky" />)
    await waitFor(() => expect(reader().querySelector('.markdown')).not.toBeNull())
    const md = reader().querySelector('.markdown')
    expect(text('p', md)).toEqual([
      'Run mvn test -Dtest=<Class>#<method> first.',
      'Never sleep — use await().atMost(…).until(…), always.',
    ])
    expect(text('code', md)).toEqual([
      'mvn test -Dtest=<Class>#<method>',
      'await().atMost(…).until(…)',
    ])
    expect(text('li', md)).toEqual(['one', 'two'])
    expect(text('em', md)).toEqual(['always'])
    // mutate is the highlighted effect
    expect(reader().querySelector('.loop-facts dd .tag.warn').textContent).toBe('mutate')
  })

  // "View source" swaps the rendered body for the file as parsed — frontmatter, then the body
  // verbatim — and back; the button says which state it is in through aria-expanded.
  it('toggles the raw source, frontmatter and body', async () => {
    render(<Loops tab="bricks" item="review" />)
    await screen.findByText('Body of review.')
    const btn = screen.getByRole('button', { name: 'View source' })
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(btn.textContent).toBe('Hide source')
    expect(reader().querySelector('pre.loop-brick-src').textContent).toBe(
      [
        '---',
        'name: review',
        'description: review does its step.',
        'effect: read',
        'agent: developer',
        'gate: human',
        'gateOn: pass',
        'outcomes: pass, fail',
        '---',
        'Body of review.',
      ].join('\n'),
    )
    expect(reader().querySelector('.markdown')).toBeNull()
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(reader().querySelector('pre.loop-brick-src')).toBeNull()
    expect(reader().querySelector('.markdown p').textContent).toBe('Body of review.')
  })

  // An overridden brick's origin fact names what it overrides; a gated one names its gate.
  it('names the override and the gate in the facts', async () => {
    const { unmount } = render(<Loops tab="bricks" item="apply" />)
    await screen.findByText('Do it our way.')
    expect(reader().querySelector('.loop-facts').textContent).toContain(
      'originproject, overrides shipped',
    )
    unmount()
    render(<Loops tab="bricks" item="review" />)
    await screen.findByText('Body of review.')
    expect(reader().querySelector('.loop-facts').textContent).toContain('gatehuman gate on pass')
  })
})

describe('Loops — the catalogue', () => {
  // A brick or template the catalogue skipped is named on the page, on every section, or a
  // team's broken override would simply be missing with nothing saying why.
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
})

// Loops › Active over a fixture `/api/loops/active` payload: one row per registered loop, read
// off its LOOP.md. Live rows carry the state; finished and unreadable rows carry only their
// identity. The selected run draws its graph's ring with the node it stands on highlighted,
// and the iteration history under it.
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
  const runRow = (root) =>
    document.querySelector(`a[href="#/loops/active/${encodeURIComponent(root)}"]`)

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

  // Grouped by what they need from you: awaiting, running, done/stopped, finished/unreadable.
  // A row prints the title, its status pill (awaiting warn, running accent, finished plain,
  // unreadable bad) and its branch; the rail counts every registered run.
  it('groups the runs by status, awaiting first, with their status pills', async () => {
    const BAD = { ...DONE, root: 'C:/w/bad', title: 'Broken', status: 'unreadable' }
    show([RUN, DONE, WAITING, BAD])
    render(<Loops tab="active" />)
    await screen.findByText('Split the parser', { selector: '.reader-title' })
    expect(listed()).toEqual([
      '# Awaiting',
      'Split the parser',
      '# Running',
      'Fix the login bug',
      '# Finished · unreadable',
      'An old loop',
      'Broken',
    ])
    const pill = (root) => runRow(root).querySelector('.tag')
    expect(
      ['C:/w/refactor', 'C:/w/fix-login', 'C:/w/old', 'C:/w/bad'].map((r) => pill(r).className),
    ).toEqual(['tag warn', 'tag acc', 'tag', 'tag bad'])
    expect(runRow('C:/w/fix-login').querySelector('.lr-desc').textContent).toBe('loop/fix-login')
    expect(text('.kind-list a')).toEqual(['Templates5', 'Bricks5', 'Active4'])
    // The statuses present nest under Active in the rail; Done · stopped has no run here.
    expect(text('.rail-cats .rc-name')).toEqual([
      'All',
      'Awaiting',
      'Running',
      'Finished · unreadable',
    ])
    expect(screen.getByRole('list', { name: 'Statuses' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Finished/ }))
    expect(listed()).toEqual(['# Finished · unreadable', 'An old loop', 'Broken'])
  })

  // The reader: status, branch, iteration of max (the graph's iteration loop's 7) and node, the
  // preset, the ring with the current node lit, and the history.
  it('draws the routed run with its state, current node and history', async () => {
    show([RUN, WAITING])
    render(<Loops tab="active" item="C:/w/fix-login" />)
    await screen.findByText('Guard the null user')
    expect(runRow('C:/w/fix-login').classList.contains('on')).toBe(true)
    expect(reader().querySelector('.reader-title').textContent).toBe('Fix the login bug')
    expect(text('.reader-tags .tag', reader())).toEqual(['Active loop', 'running'])
    expect(reader().textContent).toContain('loop/fix-login')
    expect(reader().textContent).toContain('Iteration 3 / 7 · at apply')
    expect(screen.getByLabelText('Preset for Fix the login bug').value).toBe('balanced')
    expect(text('svg.loop-ring .lr-node.current')).toEqual(['apply'])
    const rows = [...document.querySelectorAll('.loop-history tbody tr')].map((tr) =>
      text('td', tr),
    )
    expect(rows).toEqual([
      ['1', 'Guard the null user', '2', '3', 'silent', 'pass'],
      ['2', 'Rework the session check', '6', '6', 'soft', 'fail'],
    ])
  })

  it('says what an awaiting run waits on and where to answer', async () => {
    show([RUN, WAITING])
    render(<Loops tab="active" />)
    await screen.findByText('Split the parser', { selector: '.reader-title' })
    expect(reader().querySelector('.loop-run-wait').textContent).toBe(
      "Awaiting declared — Answer in the agent's session.",
    )
  })

  it('names the brick a human gate waits on', async () => {
    show([{ ...WAITING, awaiting: { kind: 'gate', node: 'adr-draft', outcome: 'pass' } }])
    render(<Loops tab="active" />)
    await screen.findByText('Split the parser', { selector: '.reader-title' })
    expect(reader().querySelector('.loop-run-wait').textContent).toBe(
      "Awaiting gate at adr-draft — Answer in the agent's session.",
    )
  })

  // With none routed, the first live run is shown: a finished one has no state to draw, and
  // sorts below the running one even when the endpoint lists it first.
  it('selects the first live run when none is routed', async () => {
    show([DONE, RUN])
    render(<Loops tab="active" />)
    await screen.findByText('Fix the login bug', { selector: '.reader-title' })
    expect(runRow('C:/w/fix-login').classList.contains('on')).toBe(true)
    expect(text('svg.loop-ring .lr-node.current')).toEqual(['apply'])
  })

  it('shows a finished run as its identity, with no picker and no ring', async () => {
    show([RUN, DONE])
    render(<Loops tab="active" item="C:/w/old" />)
    await screen.findByText('An old loop', { selector: '.reader-title' })
    expect(reader().textContent).toContain('LOOP.md is gone')
    expect(reader().querySelector('select')).toBeNull()
    expect(reader().querySelector('svg')).toBeNull()
  })

  it('posts a preset change and reads the runs again', async () => {
    show([RUN])
    api.setLoopPreset.mockImplementation(() => Promise.resolve({ ok: true, loop: RUN }))
    render(<Loops tab="active" />)
    const pick = await screen.findByLabelText('Preset for Fix the login bug')
    expect(api.activeLoops).toHaveBeenCalledTimes(1)
    fireEvent.change(pick, { target: { value: 'aggressive' } })
    expect(api.setLoopPreset).toHaveBeenCalledWith('C:/w/fix-login', 'aggressive')
    await waitFor(() => expect(api.activeLoops).toHaveBeenCalledTimes(2))
  })

  it('explains how to start a loop when none is registered', async () => {
    render(<Loops tab="active" />)
    expect(await screen.findByText('No loops yet')).toBeTruthy()
    expect(document.querySelector('.empty').textContent).toContain('geneseed loop init')
  })
})
