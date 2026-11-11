import React from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// A read still out is not a failed one and not an empty one. Each case holds one read open, checks
// that the card shows Loading and no verdict, then lands it.

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
    item: vi.fn(),
    installs: vi.fn(),
    overview: vi.fn(),
    jobs: vi.fn(),
  },
}))
vi.mock('../lib/router.js', () => ({ go: vi.fn() }))

import { api } from '../api/index.js'
import Ledger from '../pages/Overview/Ledger.jsx'
import Laws from '../pages/Laws.jsx'
import Activity from '../pages/Activity.jsx'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((a, b) => ((resolve = a), (reject = b)))
  return { promise, resolve, reject }
}
const region = (name) => within(screen.getByRole('region', { name }))

beforeEach(() => {
  vi.clearAllMocks()
  api.fleet.mockResolvedValue({ installs: [], source_fp: 'x' })
  api.usage.mockResolvedValue({ enabled: true, per_day: [], rows: [], never: [], days_counted: 40 })
  api.gates.mockResolvedValue({ rules: [], per_day: [] })
  api.update.mockResolvedValue(null)
  api.rules.mockResolvedValue({ exists: true, stats: { rules: 1, tokens: 10 } })
  api.activity.mockResolvedValue({ activity: [], ended: [], enabled: true, installs: [] })
  api.profile.mockResolvedValue({ exists: true })
  api.catalog.mockResolvedValue({ section: 'x', items: [] })
  api.installs.mockResolvedValue({ installs: [] })
  api.jobs.mockResolvedValue({ jobs: [] })
})

describe('Ledger', () => {
  it('shows Loading while usage is out, the failure once it failed', async () => {
    const usage = deferred()
    const gates = deferred()
    api.usage.mockReturnValue(usage.promise)
    api.gates.mockReturnValue(gates.promise)
    render(<Ledger overview={null} onAction={() => {}} />)
    const calls = region('Skill and agent calls')
    expect(calls.getByRole('status').textContent).toMatch(/Loading/)
    expect(calls.queryByText('Usage could not be read.')).toBeNull()
    expect(region('Gate asks · 30 days').queryByText('Gate activity could not be read.')).toBeNull()
    await act(async () => {
      usage.reject(new Error('down'))
      gates.resolve(null)
    })
    // A rejection keeps its reason; an answer of nothing has none to give.
    expect(await calls.findByText('Usage could not be read: down')).toBeTruthy()
    expect(region('Gate asks · 30 days').getByText('Gate activity could not be read.')).toBeTruthy()
  })

  // One alert per failed read: "What fires" says it too, but quietly and without a second Retry.
  // Retry hands focus to its card, since the button goes while the read is out.
  it('asks a failed usage read again from its Retry, and keeps focus on the card', async () => {
    api.usage.mockRejectedValueOnce(new Error('down'))
    const again = deferred()
    render(<Ledger overview={null} onAction={() => {}} />)
    const calls = region('Skill and agent calls')
    await calls.findByText('Usage could not be read: down')
    const fires = within(screen.getByRole('region', { name: 'What fires' }))
    expect(fires.getByText('Usage could not be read: down').getAttribute('role')).toBeNull()
    expect(calls.getByText('Usage could not be read: down').getAttribute('role')).toBe('alert')
    api.usage.mockReturnValueOnce(again.promise)
    const asked = api.usage.mock.calls.length
    await act(async () => calls.getByRole('button', { name: 'Retry: usage' }).click())
    expect(api.usage.mock.calls.length).toBe(asked + 1)
    expect(document.activeElement).toBe(
      screen.getByRole('region', { name: 'Skill and agent calls' }),
    )
    await act(async () => again.resolve({ enabled: true, per_day: [], rows: [], never: [] }))
    expect(calls.queryByText(/Usage could not be read/)).toBeNull()
  })

  it('gives no root-file or Needs verdict before the fleet lands', async () => {
    const fleet = deferred()
    api.fleet.mockReturnValue(fleet.promise)
    render(<Ledger overview={null} onAction={() => {}} />)
    expect(screen.queryByText('No root file to measure.')).toBeNull()
    expect(screen.queryByText('Nothing needs you.')).toBeNull()
    await act(async () => fleet.resolve({ installs: [], source_fp: 'x' }))
    expect(await screen.findByText('No root file to measure.')).toBeTruthy()
    expect(await screen.findByText('Nothing needs you.')).toBeTruthy()
  })
})

// A failed read says so, and an all-clear needs every read it rests on.
describe('Ledger: a failed read', () => {
  it('says the installs could not be read, and gives no root-file or Needs verdict', async () => {
    api.fleet.mockRejectedValue(new Error('down'))
    render(<Ledger overview={null} onAction={() => {}} />)
    const root = within(await screen.findByRole('region', { name: 'Root file vs ceiling' }))
    expect(await root.findByText('The installs could not be read.')).toBeTruthy()
    expect(region('Loaded every turn').getByText('The installs could not be read.')).toBeTruthy()
    expect(screen.queryByText('No root file to measure.')).toBeNull()
    expect(await screen.findByText(/this list may be incomplete/)).toBeTruthy()
    expect(screen.queryByText('Nothing needs you.')).toBeNull()
  })

  it('withholds the all-clear when one other read it rests on failed', async () => {
    api.usage.mockImplementation(() => Promise.reject(new Error('down')))
    render(<Ledger overview={null} onAction={() => {}} />)
    expect(await screen.findByText(/this list may be incomplete/)).toBeTruthy()
    expect(screen.queryByText('Nothing needs you.')).toBeNull()
  })
})

// The picked install's overview lands after the catalog. Reading the page before it showed
// "always" and "Instruction", and counted a switched-off gate as Gated, then corrected itself.
describe('Constitution', () => {
  const PAYLOAD = {
    section: 'laws',
    items: [
      { name: 'ont:ownership', title: 'Ownership', tier: 'ontology' },
      { name: 'I', title: 'Secrets', tier: 'invariant' },
    ],
  }
  const INSTALL = { id: 'a', host: 'claude', scope: 'global', path: '/c', state: 'active' }

  it('shows no gate verdict until the picked install is read', async () => {
    api.catalog.mockResolvedValue(PAYLOAD)
    api.installs.mockResolvedValue({ installs: [INSTALL] })
    const own = deferred()
    api.overview.mockReturnValue(own.promise)
    const { container } = render(<Laws />)
    await waitFor(() => expect(api.overview).toHaveBeenCalled())
    expect(container.querySelector('.tier-strip')).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/Loading/)
    await act(async () =>
      own.resolve({ install: { ...INSTALL, secretsGate: false, ownershipGate: false } }),
    )
    const gated = await screen.findByRole('button', { name: /^Gated/ })
    expect(gated.textContent).toBe('Gated 0')
    expect(container.querySelector('.tier-strip').textContent).toMatch(/gate off/)
  })

  it('says the gates are unread when that read fails, and never claims them armed', async () => {
    api.catalog.mockResolvedValue(PAYLOAD)
    api.installs.mockResolvedValue({ installs: [INSTALL] })
    api.overview.mockRejectedValue(new Error('gone'))
    const { container } = render(<Laws />)
    expect(await screen.findByText(/Could not read this install's gates/)).toBeTruthy()
    expect(container.querySelector('.tier-strip').textContent).toMatch(/gates unread/)
    expect(container.querySelector('.tier-strip').textContent).not.toMatch(/always/)
    // What enforces a gated rule is the unknown: no row says "Hook gate", and Gated has no figure.
    expect(container.textContent).not.toContain('Hook gate')
    expect(container.querySelector('.law-enf').textContent).toBe('Unknown')
    const gated = screen.getByRole('button', { name: /^Gated/ })
    expect(gated.textContent.trim()).toBe('Gated')
    expect(gated.disabled).toBe(true)
  })

  it('never hangs on a read that finished with another install', async () => {
    api.catalog.mockResolvedValue(PAYLOAD)
    api.installs.mockResolvedValue({ installs: [INSTALL] })
    api.overview.mockResolvedValue({ install: { host: 'bob', path: '/other' } })
    const { container } = render(<Laws />)
    expect(await screen.findByText(/Could not read this install's gates/)).toBeTruthy()
    expect(container.querySelector('.tier-strip').textContent).toMatch(/gates unread/)
  })

  it('reads the app overview when it is the pick, with no read of its own', async () => {
    api.catalog.mockResolvedValue(PAYLOAD)
    api.installs.mockResolvedValue({ installs: [INSTALL] })
    const overview = { install: { ...INSTALL, secretsGate: false } }
    const { container } = render(<Laws overview={overview} />)
    await waitFor(() => expect(container.querySelector('.tier-strip')).toBeTruthy())
    expect(container.querySelector('.tier-strip').textContent).toMatch(/gate off/)
    expect(api.overview).not.toHaveBeenCalled()
  })
})

describe('Activity: Waiting on you', () => {
  const card = () => screen.getByRole('region', { name: 'Waiting on you' })

  it('shows Loading, not a dash, then a singular count', async () => {
    const first = deferred()
    api.activity.mockReturnValue(first.promise)
    render(<Activity />)
    expect(within(card()).getByRole('status').textContent).toMatch(/Loading/)
    expect(card().textContent).not.toContain('—')
    await act(async () =>
      first.resolve({
        enabled: true,
        installs: [],
        ended: [],
        activity: [{ session_id: 's', status: 'blocked', host: 'claude', updated_at: 1 }],
      }),
    )
    await waitFor(() => expect(card().querySelector('.act-wait').textContent).toBe('1 session'))
  })

  it('prints no figure while tracking is off', async () => {
    api.activity.mockResolvedValue({ enabled: false, installs: [], ended: [], activity: [] })
    render(<Activity />)
    expect(await within(card()).findByText(/Turn tracking on/)).toBeTruthy()
    expect(card().querySelector('.act-wait')).toBeNull()
  })
})
