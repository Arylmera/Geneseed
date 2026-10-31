import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The Overview's actions: exactly ONE filled (primary) button or link per loaded view, and on
// the Ledger no two controls share an accessible name, so a screen reader hears "Rebuild
// claude · global" rather than six "Rebuild"s. The filled count is every `.btn` (button or
// anchor) without `.ghost`. Every Ledger rebuild names its installs (the `rebuild` action) and
// asks first; the confirm is a stub through ConfirmContext, so a test reads what it asked.

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
    doctor: vi.fn(),
    recent: vi.fn(),
    themes: vi.fn(),
    docs: vi.fn(),
    installs: vi.fn(),
  },
}))

import Ledger from '../pages/Overview/Ledger.jsx'
import Overview from '../pages/Overview/index.jsx'
import { LAYOUTS } from '../hooks/useLayout.js'
import { api } from '../api/index.js'
import { clearAsyncCache } from '../hooks/useAsync.js'
import { ConfirmContext } from '../hooks/useConfirm.jsx'

const withConfirm = (ui, confirm = vi.fn(async () => true)) => (
  <ConfirmContext.Provider value={confirm}>{ui}</ConfirmContext.Provider>
)

const install = (host, verdict) => ({
  id: `${host}:global:/h/.${host}`,
  host,
  scope: 'global',
  path: `/h/.${host}`,
  state: 'active',
  theme: 'neutral',
  footprint: 'lean',
  verdict,
  diffable: true,
  drift: { edited: 0, added: 0, missing: 0 },
  built_epoch: null,
  cost: null,
})
const BEHIND = { installs: [install('claude', 'behind'), install('opencode', 'behind')] }
const SYNCED = { installs: [install('claude', 'synced'), install('opencode', 'synced')] }
const DUE = { current: '4.16.0', latest: '4.17.0', available: true, install: 'npm-global' }
const NONE = { current: '4.16.0', latest: '4.16.0', available: false, install: 'npm-global' }

const overview = {
  deployed: true,
  theme: 'imperial',
  emit: 'claude-global',
  target: '/home/u/.claude',
  footprint: 'lean',
  build_time: '2026-10-20 09:41',
  diff: { edited: 0, added: 0, missing: 0 },
  counts: { agents: 3, skills: 5, laws: 9, memory: 0, notebook: 0, wiki: 0, config: 0 },
}

beforeEach(() => {
  vi.clearAllMocks()
  clearAsyncCache()
  localStorage.clear()
  for (const k of ['usage', 'gates', 'rules', 'activity', 'profile', 'recent', 'themes']) {
    api[k].mockImplementation(() => Promise.resolve(null))
  }
  api.catalog.mockImplementation(() => Promise.resolve({ items: [] }))
  // A live fleet: with no active install the Overview is the onboarding form, not the Ledger.
  api.installs.mockResolvedValue(SYNCED)
  api.fleet.mockResolvedValue(BEHIND)
  api.update.mockResolvedValue(NONE)
  api.doctor.mockResolvedValue({ groups: [{ label: 'links', problems: [] }] })
  // NewHere shows: its link must not be a second primary.
  api.docs.mockResolvedValue({
    groups: [{ id: 'understand', label: 'Understand', pages: [{ id: 'harness', title: 'h' }] }],
  })
})

const filled = () =>
  [...document.querySelectorAll('button.btn, a.btn')].filter((b) => !b.classList.contains('ghost'))
const nameOf = (el) => (el.getAttribute('aria-label') || el.textContent).trim()

describe('Ledger: one primary action, every control named once', () => {
  it('with installs behind, the one filled action is "Rebuild all behind (N)"', async () => {
    api.update.mockResolvedValue(DUE)
    render(<Ledger overview={null} onAction={vi.fn()} />)
    await screen.findByText('4.17.0 available')
    await screen.findByRole('button', { name: 'Rebuild all behind (2)' })
    expect(filled().map(nameOf)).toEqual(['Rebuild all behind (2)'])
    // An update that is due yields to the rebuild: still there, but ghost.
    expect(screen.getByRole('button', { name: 'Update' }).className).toBe('btn ghost')
    const primary = screen.getByRole('button', { name: 'Rebuild all behind (2)' })
    expect(primary.title).toBe('Rebuilds claude · global, opencode · global')
  })

  it('with nothing behind and an update due, Update is the one filled action', async () => {
    api.fleet.mockResolvedValue(SYNCED)
    api.update.mockResolvedValue(DUE)
    render(<Ledger overview={null} onAction={() => {}} />)
    await screen.findByText('4.17.0 available')
    await screen.findAllByRole('button', { name: /^Open / })
    expect(filled().map(nameOf)).toEqual(['Update'])
  })

  it('with nothing behind and nothing due, no action is filled', async () => {
    api.fleet.mockResolvedValue(SYNCED)
    render(<Ledger overview={null} onAction={() => {}} />)
    await screen.findAllByRole('button', { name: /^Open / })
    expect(filled()).toEqual([])
  })

  it('no two buttons or links share an accessible name', async () => {
    api.fleet.mockResolvedValue({
      installs: [...BEHIND.installs, install('bob', 'synced'), install('openclaude', 'synced')],
    })
    render(<Ledger overview={null} onAction={vi.fn()} />)
    await screen.findByRole('button', { name: 'Rebuild all behind (2)' })
    const names = [...screen.getAllByRole('button'), ...screen.queryAllByRole('link')].map(nameOf)
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([])
    const row = screen.getByRole('button', { name: 'Rebuild claude · global' })
    expect(row.className).toBe('btn ghost sm')
    expect(row.textContent).toBe('Rebuild')
    expect(row.title).toBe('Rebuilds claude · global only')
    expect(screen.getByRole('button', { name: 'Open bob · global' })).toBeTruthy()
  })
})

// Two behind, one in step: every rebuild control must send exactly the installs it names.
const MIXED = {
  installs: [install('claude', 'behind'), install('bob', 'synced'), install('opencode', 'behind')],
}
const CLAUDE = { host: 'claude', path: '/h/.claude' }
const OPENCODE = { host: 'opencode', path: '/h/.opencode' }

describe('Ledger: a rebuild names its installs and asks first', () => {
  beforeEach(() => api.fleet.mockResolvedValue(MIXED))

  it('the header rebuilds only the behind installs, after naming each', async () => {
    const confirm = vi.fn(async () => true)
    const onAction = vi.fn(async () => 'j1')
    render(withConfirm(<Ledger overview={null} onAction={onAction} />, confirm))
    fireEvent.click(await screen.findByRole('button', { name: 'Rebuild all behind (2)' }))
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(1))
    expect(confirm).toHaveBeenCalledWith(
      'Rebuild claude · global, opencode · global? Each is re-rendered from source with its own ' +
        'settings.',
      { title: 'Rebuild 2 installs?', confirmLabel: 'Rebuild' },
    )
    expect(onAction).toHaveBeenCalledWith('rebuild', { installs: [CLAUDE, OPENCODE] })
  })

  it('a cancelled confirm sends nothing', async () => {
    const confirm = vi.fn(async () => false)
    const onAction = vi.fn()
    render(withConfirm(<Ledger overview={null} onAction={onAction} />, confirm))
    fireEvent.click(await screen.findByRole('button', { name: 'Rebuild all behind (2)' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(onAction).not.toHaveBeenCalled()
  })

  it('a row rebuilds exactly its own install', async () => {
    const confirm = vi.fn(async () => true)
    const onAction = vi.fn(async () => 'j1')
    render(withConfirm(<Ledger overview={null} onAction={onAction} />, confirm))
    fireEvent.click(await screen.findByRole('button', { name: 'Rebuild opencode · global' }))
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(1))
    expect(confirm.mock.calls[0][1]).toEqual({
      title: 'Rebuild opencode · global?',
      confirmLabel: 'Rebuild',
    })
    expect(onAction).toHaveBeenCalledWith('rebuild', { installs: [OPENCODE] })
  })

  it('a Needs row rebuilds the one install it names', async () => {
    const onAction = vi.fn(async () => 'j1')
    render(withConfirm(<Ledger overview={null} onAction={onAction} />))
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Rebuild: claude · global is behind its source',
      }),
    )
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(1))
    expect(onAction).toHaveBeenCalledWith('rebuild', { installs: [CLAUDE] })
  })

  it('while the job runs, only the row it targets shows the sweep', async () => {
    const onAction = vi.fn(async () => 'j7')
    const ui = (runs) => withConfirm(<Ledger overview={null} runs={runs} onAction={onAction} />)
    const { rerender } = render(ui([]))
    fireEvent.click(await screen.findByRole('button', { name: 'Rebuild opencode · global' }))
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(1))
    rerender(ui([{ id: 'j7', status: 'running' }]))
    const bar = await screen.findByRole('progressbar')
    expect(screen.getAllByRole('progressbar')).toHaveLength(1)
    expect(bar.getAttribute('aria-label')).toBe('Rebuilding opencode · global')
    expect(bar.closest('tr').textContent).toContain('/h/.opencode')
    rerender(ui([{ id: 'j7', status: 'done' }]))
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull())
  })
})

// Open sets the Hosts tab's own pick to that install and goes there: there is no console-wide
// view to move, so nothing can refuse and nothing else changes.
describe('Ledger: Open', () => {
  beforeEach(() => {
    api.fleet.mockResolvedValue(SYNCED)
    window.location.hash = '#/'
    localStorage.clear()
  })

  it('picks the install on the Hosts tab, then goes there', async () => {
    render(<Ledger overview={null} onAction={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open opencode · global' }))
    await waitFor(() => expect(window.location.hash).toBe('#/installs/hosts'))
    const row = SYNCED.installs.find((i) => i.host === 'opencode')
    expect(localStorage.getItem('geneseed-install-hosts')).toBe(row.id)
  })

  // The row carries its own install's settings (no viewed install to read them off), and its
  // View diff opens Local edits on that row's install.
  it('a row details its own voice, footprint, posture and mode, and diffs its own install', async () => {
    const cl = { ...install('claude', 'synced'), posture: 'artisan', mode: 'foreman' }
    api.fleet.mockResolvedValue({ installs: [cl] })
    render(<Ledger overview={null} onAction={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Details for claude · global' }))
    expect(
      screen.getByText('Voice neutral · lean footprint · artisan posture · foreman mode'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'View diff for claude · global' }))
    expect(localStorage.getItem('geneseed-install-edits')).toBe(cl.id)
  })
})

// Onboarding is for a machine with NO active install, read off the fleet. `overview.deployed` is
// a fact about the default install only: the Ledger shows over any live fleet, never "deploy your
// harness".
describe('Overview: onboarding only for an empty fleet', () => {
  const notHere = { ...overview, deployed: false }
  const row = (state) => ({
    id: `claude:global:/h/.claude`,
    host: 'claude',
    scope: 'global',
    path: '/h/.claude',
    state,
  })

  it('a view on a disabled install over an active fleet shows the Ledger', async () => {
    api.installs.mockResolvedValue({ installs: [row('disabled'), { ...row('active'), id: 'o' }] })
    api.fleet.mockResolvedValue(SYNCED)
    render(<Overview overview={notHere} themes={[]} onAction={() => {}} />)
    await screen.findByRole('heading', { name: 'Installed harnesses' })
    expect(screen.queryByText('Deploy your harness')).toBeNull()
  })

  it('a fleet with no active install onboards', async () => {
    api.installs.mockResolvedValue({ installs: [row('disabled')] })
    api.themes.mockResolvedValue({ themes: [], current: 'neutral' })
    render(<Overview overview={notHere} themes={[]} onAction={() => {}} />)
    await screen.findByText('Deploy your harness')
  })

  // The fleet decides, not the default install's manifest: a disabled install still carries
  // one, and with nothing active the form shows even though `deployed` says true.
  it('a deployed but inactive install with no active one onboards', async () => {
    api.installs.mockResolvedValue({ installs: [row('disabled')] })
    api.themes.mockResolvedValue({ themes: [], current: 'neutral' })
    render(<Overview overview={{ ...overview, deployed: true }} themes={[]} onAction={() => {}} />)
    await screen.findByText('Deploy your harness')
  })
})

const lensMarker = {
  cultivar: 'germination',
  greenhouse: 'Capability mix',
  operator: 'HARNESS // STATUS READOUT',
  journal: 'Today in this harness',
}

describe('Overview lenses: one h1, one primary action', () => {
  for (const lens of Object.keys(lensMarker)) {
    it(`${lens}`, async () => {
      api.fleet.mockResolvedValue(SYNCED)
      const { container } = render(
        <Overview overview={overview} themes={[]} layout={lens} onAction={() => {}} />,
      )
      await screen.findByText(lensMarker[lens])
      await screen.findByText(/^Start$/)
      expect(document.querySelectorAll('h1').length).toBe(1)
      expect(filled().map(nameOf)).toEqual(['Rebuild'])
      // `.pad:has(> .jr-head)` (styles.css) sizes the Journal page: the head stays a direct
      // child of the page's own box, with the Overview header beside it, not around it.
      if (lens === 'journal')
        expect(container.querySelector('.jr-head').parentElement).toBe(container)
    })
  }
})

describe('Overview View control', () => {
  for (const layout of ['overview', 'greenhouse']) {
    it(`lists the five views on the ${layout} arm and switches on click`, async () => {
      api.fleet.mockResolvedValue(SYNCED)
      const onLayout = vi.fn()
      render(
        <Overview
          overview={overview}
          themes={[]}
          layout={layout}
          onAction={() => {}}
          onLayout={onLayout}
        />,
      )
      const group = await screen.findByRole('group', { name: 'View' })
      const buttons = within(group).getAllByRole('button')
      expect(buttons.map((b) => b.textContent)).toEqual(LAYOUTS.map((l) => l.short))
      expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(
        LAYOUTS.map((l) => String(l.id === layout)),
      )
      // With the View control beside a lens's own direction switcher, no two names collide.
      if (layout !== 'overview') await screen.findByText(lensMarker[layout])
      const names = [...screen.getAllByRole('button'), ...screen.queryAllByRole('link')].map(nameOf)
      expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([])
      fireEvent.click(within(group).getByRole('button', { name: 'Journal' }))
      expect(onLayout).toHaveBeenCalledWith('journal')
      await waitFor(() => expect(document.querySelectorAll('h1').length).toBe(1))
    })
  }
})
