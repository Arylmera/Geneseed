import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The Overview's actions: exactly ONE filled (primary) button or link per loaded view, and on
// the Ledger no two controls share an accessible name, so a screen reader hears "Rebuild all
// installs (claude · global needs it)" rather than six "Rebuild"s. The filled count is every
// `.btn` (button or anchor) without `.ghost`.

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
    doctor: vi.fn(),
    recent: vi.fn(),
    themes: vi.fn(),
    docs: vi.fn(),
  },
}))

import Ledger from '../pages/Overview/Ledger.jsx'
import Overview from '../pages/Overview/index.jsx'
import { LAYOUTS } from '../hooks/useLayout.js'
import { api } from '../api/index.js'
import { clearAsyncCache } from '../hooks/useAsync.js'

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
  it('with installs behind, the one filled action is "Rebuild all (N behind)"', async () => {
    api.update.mockResolvedValue(DUE)
    const onAction = vi.fn()
    render(<Ledger overview={null} onAction={onAction} />)
    await screen.findByText('4.17.0 available')
    await screen.findByRole('button', { name: 'Rebuild all (2 behind)' })
    expect(filled().map(nameOf)).toEqual(['Rebuild all (2 behind)'])
    // An update that is due yields to the rebuild: still there, but ghost.
    expect(screen.getByRole('button', { name: 'Update' }).className).toBe('btn ghost')
    const primary = screen.getByRole('button', { name: 'Rebuild all (2 behind)' })
    expect(primary.title).toBe('Rebuilds every install on this machine')
    fireEvent.click(primary)
    expect(onAction).toHaveBeenCalledWith('build-all')
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
    const onAction = vi.fn()
    render(<Ledger overview={null} onAction={onAction} />)
    await screen.findByRole('button', { name: 'Rebuild all (2 behind)' })
    const names = [...screen.getAllByRole('button'), ...screen.queryAllByRole('link')].map(nameOf)
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([])
    const row = screen.getByRole('button', {
      name: 'Rebuild all installs (claude · global needs it)',
    })
    expect(row.className).toBe('btn ghost sm')
    expect(row.textContent).toBe('Rebuild all')
    expect(row.title).toBe('Rebuilds every install on this machine')
    fireEvent.click(row)
    expect(onAction).toHaveBeenCalledWith('build-all')
    expect(screen.getByRole('button', { name: 'Open bob · global' })).toBeTruthy()
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
