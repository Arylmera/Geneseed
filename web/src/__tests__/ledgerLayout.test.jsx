import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The Ledger's layout ("Ledger II"): the health card carries the page's actions, each fleet row
// opens a details row with its cost breakdown and a diff link, and a KPI row sums the fleet.
// The KPI math lives in pure helpers (pages/Overview/ledgerKpi.js); the expected values below
// are worked out by hand from the fixtures, never recorded.

vi.mock('../api/index.js', () => ({
  api: {
    fleet: vi.fn(),
    usage: vi.fn(),
    gates: vi.fn(),
    update: vi.fn(),
    rules: vi.fn(),
    activity: vi.fn(),
    profile: vi.fn(),
    catalog: vi.fn(),
    selectView: vi.fn(),
  },
}))

import Ledger from '../pages/Overview/Ledger.jsx'
import {
  alwaysOnRange,
  gateSummary,
  usageTotal,
  rootFileFigure,
} from '../pages/Overview/ledgerKpi.js'
import { api } from '../api/index.js'
import { clearAsyncCache } from '../hooks/useAsync.js'

const install = (host, verdict, cost) => ({
  id: `${host}:global:/h/.${host}`,
  host,
  scope: 'global',
  path: `/h/.${host}`,
  state: 'active',
  theme: 'neutral',
  footprint: 'lean',
  verdict,
  diffable: true,
  drift: { edited: 0, added: 0, missing: 0, linked: 0, stale: 0 },
  built_epoch: null,
  cost,
})
// claude: 33600 / 40000 = 84 % of its ceiling, 62000 chars always-on (≈15.5k tokens).
// bob:    34000 / 40000 = 85 % of its ceiling, 48000 chars always-on (≈12.0k tokens).
// opencode: no cost, so it is in neither figure.
const CLAUDE = install('claude', 'behind', {
  carrier: 33600,
  skills: 20400,
  agents: 4800,
  context: 3200,
  ceiling: 40000,
})
const BOB = install('bob', 'synced', {
  carrier: 34000,
  skills: 10000,
  agents: 3000,
  context: 1000,
  ceiling: 40000,
})
const OPENCODE = install('opencode', 'synced', null)
const FLEET = { installs: [CLAUDE, BOB, OPENCODE], source_fp: 'abc', version: '4.22.0' }

const day = (at) => Array.from({ length: 30 }, (_, d) => at[d] ?? 0)
// law-4 is Law IV; the catalog names it. 12 + 3 = 15 asks; day 28 sums 4 + 1, day 29 sums 8 + 2.
const GATES = {
  rules: [
    { rule: 'law-4', n: 12, per_day: day({ 28: 4, 29: 8 }) },
    { rule: 'wiki', n: 3, per_day: day({ 28: 1, 29: 2 }) },
  ],
}
const LAWS = {
  items: [{ name: 'IV', title: 'Rule IV — Deletio Deliberata · Deletion Is Deliberate' }],
}
const USAGE = {
  enabled: true,
  since: '2026-10-14',
  days_counted: 11,
  per_day: day({ 19: 14, 20: 67, 29: 63 }),
  rows: [],
  never: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  clearAsyncCache()
  for (const k of ['update', 'rules', 'activity', 'profile']) {
    api[k].mockImplementation(() => Promise.resolve(null))
  }
  api.catalog.mockImplementation((kind) => Promise.resolve(kind === 'laws' ? LAWS : { items: [] }))
  api.fleet.mockResolvedValue(FLEET)
  api.gates.mockResolvedValue(GATES)
  api.usage.mockResolvedValue(USAGE)
})

describe('Ledger health card', () => {
  it('holds "Run doctor" and the one primary, and names the source release', async () => {
    const onAction = vi.fn()
    render(<Ledger overview={null} onAction={onAction} />)
    const health = await screen.findByRole('region', { name: 'Harness needs a look.' })
    const h = within(health)
    expect(h.getByRole('button', { name: 'Rebuild all behind (1)' }).className).toBe('btn')
    fireEvent.click(h.getByRole('button', { name: 'Run doctor' }))
    expect(onAction).toHaveBeenCalledWith('doctor')
    expect(h.getByRole('status').textContent).toContain('Source is 4.22.0')
    // The header keeps no rebuild of its own.
    expect(screen.getAllByRole('button', { name: /^Rebuild all behind/ })).toHaveLength(1)
  })
})

describe('Ledger fleet details row', () => {
  it('starts collapsed, and the toggle reveals the cost breakdown and the diff link', async () => {
    render(<Ledger overview={null} onAction={vi.fn()} />)
    const toggle = await screen.findByRole('button', { name: 'Details for claude · global' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(/What rides every turn/)).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const table = screen.getByRole('table', { name: 'Installs' })
    expect(within(table).getByText('What rides every turn · ≈15.5k tokens')).toBeTruthy()
    // The breakdown is one labelled image, each part in tokens (characters ÷ 4) of the 15500.
    expect(
      within(table).getByRole('img', {
        name: 'claude · global: Root file: 8400 of 15500, Skill list: 5100 of 15500, Agent list: 1200 of 15500, Session files: 800 of 15500',
      }),
    ).toBeTruthy()
    const link = within(table).getByRole('link', { name: 'View diff for claude · global' })
    expect(link.getAttribute('href')).toBe('#/installs/edits')
    // The other rows stay collapsed.
    expect(
      screen
        .getByRole('button', { name: 'Details for bob · global' })
        .getAttribute('aria-expanded'),
    ).toBe('false')
    fireEvent.click(toggle)
    expect(screen.queryByText(/What rides every turn/)).toBeNull()
  })
})

describe('Ledger KPI helpers', () => {
  // With no install selected, the card falls back to the fleet's worst share of its ceiling.
  it('rootFileFigure picks the highest share of the ceiling when none is selected', () => {
    expect(rootFileFigure(FLEET.installs)).toEqual({
      label: 'bob · global',
      carrier: 34000,
      ceiling: 40000,
      pct: 85,
      selected: false,
    })
    // No ceiling, no cost, or disabled: nothing to measure.
    expect(
      rootFileFigure([
        OPENCODE,
        install('bob', 'synced', { ...BOB.cost, ceiling: 0 }),
        { ...CLAUDE, state: 'disabled' },
      ]),
    ).toBeNull()
    // A carrier that is not a number has no share; it must not win the rank as NaN.
    expect(
      rootFileFigure([install('opencode', 'synced', { ...BOB.cost, carrier: undefined }), BOB]),
    ).toMatchObject({ label: 'bob · global', pct: 85 })
  })

  // The card follows the install the console views (the topbar picker), not the worst one;
  // an unmeasured selection falls back to the worst rather than showing nothing.
  it('rootFileFigure shows the selected install, worst share or not', () => {
    const sel = FLEET.installs.map((i) => ({ ...i, selected: i.host === 'claude' }))
    expect(rootFileFigure(sel)).toMatchObject({ label: 'claude · global', selected: true })
    const unmeasured = FLEET.installs.map((i) =>
      i.host === 'claude' ? { ...i, selected: true, cost: null } : i,
    )
    expect(rootFileFigure(unmeasured)).toMatchObject({ label: 'bob · global', selected: false })
  })

  it('alwaysOnRange spans the measured installs and names the most expensive', () => {
    const r = alwaysOnRange(FLEET.installs)
    expect([r.min, r.max, r.top.host, r.shown.host]).toEqual([48000, 62000, 'claude', 'claude'])
    // The card details the install the console views, not the most expensive.
    const sel = FLEET.installs.map((i) => ({ ...i, selected: i.host === 'bob' }))
    expect(alwaysOnRange(sel).shown.host).toBe('bob')
    expect(alwaysOnRange([OPENCODE])).toBeNull()
  })

  it('usageTotal sums the calls per day', () => {
    expect(usageTotal(USAGE)).toBe(144)
    expect(usageTotal(null)).toBe(0)
  })

  it('gateSummary totals every rule and names the top one', () => {
    const g = gateSummary(GATES, LAWS)
    expect(g.total).toBe(15)
    expect(g.top).toEqual({ name: 'Deletion Is Deliberate', n: 12 })
    expect(g.perDay.slice(27)).toEqual([0, 5, 10])
    expect(gateSummary({ rules: [] }, LAWS)).toEqual({ total: 0, top: null, perDay: [] })
  })
})

describe('Ledger KPI cards', () => {
  it('render the worst root file, the cost range, the call count and the gate asks', async () => {
    render(<Ledger overview={null} onAction={vi.fn()} />)
    const root = within(await screen.findByRole('region', { name: 'Root file vs ceiling' }))
    expect(await root.findByText('≈8.5k / ≈10.0k tokens')).toBeTruthy()
    expect(root.getByText('bob · global')).toBeTruthy()
    expect(
      root.getByRole('img', {
        name: 'Worst root file: bob · global, 85 percent of its ceiling: 8500 of 10000',
      }),
    ).toBeTruthy()
    // No install selected: the card details the most expensive, the fleet range under it.
    const cost = within(screen.getByRole('region', { name: 'Loaded every turn' }))
    expect(cost.getByText('≈15.5k tokens')).toBeTruthy()
    expect(cost.getByText('claude · global')).toBeTruthy()
    expect(cost.getByText('All installs: ≈12.0k – ≈15.5k tokens')).toBeTruthy()
    const calls = within(screen.getByRole('region', { name: 'Skill and agent calls' }))
    expect(await calls.findByText('144')).toBeTruthy()
    expect(calls.getByText('since 2026-10-14')).toBeTruthy()
    const gates = within(screen.getByRole('region', { name: 'Gate asks · 30 days' }))
    expect(await gates.findByText('15')).toBeTruthy()
    expect(gates.getByText('· Deletion Is Deliberate 12')).toBeTruthy()
    expect(gates.getByRole('link', { name: 'Open the Constitution' }).getAttribute('href')).toBe(
      '#/laws',
    )
  })

  // per_day is always the last 30 days: past day 30 an older `since` would label a 30-day sum
  // as all-time, so the card says "30 days" instead.
  it('name the call window "30 days" once 30 days are counted', async () => {
    api.usage.mockResolvedValue({ ...USAGE, since: '2026-01-02', days_counted: 30 })
    render(<Ledger overview={null} onAction={vi.fn()} />)
    const calls = within(await screen.findByRole('region', { name: 'Skill and agent calls' }))
    expect(await calls.findByText('30 days')).toBeTruthy()
    expect(calls.queryByText(/since/)).toBeNull()
  })

  it('say in words when gate activity could not be read', async () => {
    api.gates.mockResolvedValue(null)
    api.usage.mockResolvedValue(null)
    render(<Ledger overview={null} onAction={vi.fn()} />)
    const gates = within(await screen.findByRole('region', { name: 'Gate asks · 30 days' }))
    expect(await gates.findByText('Gate activity could not be read.')).toBeTruthy()
    const calls = within(screen.getByRole('region', { name: 'Skill and agent calls' }))
    expect(calls.getByText('Usage could not be read.')).toBeTruthy()
  })
})
