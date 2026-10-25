import React from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, it, expect, vi } from 'vitest'

// Settings is prop-driven now: the server controls only touch the api on a click, and the
// mount-time reads (api.update, api.docsPage) are optional-chained, so an empty stub keeps
// the import side-effect-free; a test that needs one sets it.
vi.mock('../api/index.js', () => ({ api: {} }))

import Settings from '../pages/Settings/index.jsx'
import { api } from '../api/index.js'
import { ConfirmContext } from '../hooks/useConfirm.jsx'

// Sections are h3 under the page's one h2 (which is also "Server", the tab's name).
const section = (name) => screen.getByRole('heading', { level: 3, name }).closest('section')

describe('Settings', () => {
  afterEach(() => {
    vi.useRealTimers()
    delete api.update
  })

  // Update pulls and then rebuilds every ACTIVE install (upgrade -> rebuild-all), so it asks first
  // and names them, read at click time; a declined confirm sends nothing. With the list
  // unreadable it still asks, in general words.
  describe('Update asks first', () => {
    const ui = (confirm, onAction) => (
      <ConfirmContext.Provider value={confirm}>
        <Settings onAction={onAction} />
      </ConfirmContext.Provider>
    )
    const MSG = (names) =>
      `Update Geneseed, then rebuild every active install: ${names}? ` +
      'Each is rebuilt in place with its own settings; files you edited are kept.'
    const OPTS = { title: 'Update and rebuild?', confirmLabel: 'Update' }

    it('names the active installs, then runs update', async () => {
      api.update = vi.fn(async () => ({ install: 'git' }))
      api.installs = vi.fn(async () => ({
        installs: [
          { id: 'a', host: 'claude', scope: 'global', path: '/h/.claude', state: 'active' },
          { id: 'b', host: 'bob', scope: 'global', path: '/h/.bob', state: 'absent' },
          { id: 'c', host: 'opencode', scope: 'project', path: '/git/Terra', state: 'active' },
        ],
      }))
      const confirm = vi.fn(async () => true)
      const onAction = vi.fn()
      render(ui(confirm, onAction))
      const btn = await screen.findByText('Update (git pull + rebuild)')
      await act(async () => fireEvent.click(btn))
      expect(confirm).toHaveBeenCalledWith(MSG('Claude Code · global, Terra · project'), OPTS)
      expect(onAction).toHaveBeenCalledWith('update')
    })

    it('a declined confirm sends nothing; an unreadable list still asks', async () => {
      api.update = vi.fn(async () => ({ install: 'git' }))
      api.installs = vi.fn(async () => {
        throw new Error('daemon restarting')
      })
      const confirm = vi.fn(async () => false)
      const onAction = vi.fn()
      render(ui(confirm, onAction))
      const btn = await screen.findByText('Update (git pull + rebuild)')
      await act(async () => fireEvent.click(btn))
      expect(confirm).toHaveBeenCalledWith(MSG('the installs it finds'), OPTS)
      expect(onAction).not.toHaveBeenCalled()
    })
  })

  it('renders maintenance, the update button, and server control', () => {
    render(<Settings onAction={() => {}} />)
    // Per-install detail and build moved to the Harnesses tab + Dashboard; Settings keeps
    // machine maintenance (incl. Update) and server control.
    expect(screen.getByText('Add to PATH')).toBeTruthy()
    expect(screen.getByText('Remove from PATH')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Update' })).toBeTruthy()
    expect(screen.getByText('Stop server')).toBeTruthy()
  })

  // The Update button names the route /api/update says this copy takes (`install`): a clone
  // pulls, an npm-global install runs npm install -g, and a copy the console cannot update
  // (`other`) gets the command to run by hand instead of a button the server refuses. Until
  // the answer arrives, or without one, it is plain "Update".
  it('labels Update by how this copy of Geneseed updates', async () => {
    api.update = vi.fn(async () => ({ install: 'npm-global' }))
    const npm = render(<Settings onAction={() => {}} />)
    expect(await screen.findByText('Update (npm install -g + rebuild)')).toBeTruthy()
    npm.unmount()

    api.update = vi.fn(async () => ({ install: 'git' }))
    const clone = render(<Settings onAction={() => {}} />)
    expect(await screen.findByText('Update (git pull + rebuild)')).toBeTruthy()
    clone.unmount()

    // A daemon older than the `install` field sent only `git`.
    api.update = vi.fn(async () => ({ git: true }))
    const old = render(<Settings onAction={() => {}} />)
    expect(await screen.findByText('Update (git pull + rebuild)')).toBeTruthy()
    old.unmount()

    api.update = vi.fn(async () => ({ install: 'other', command: 'npm install -g geneseed' }))
    render(<Settings onAction={() => {}} />)
    expect(await screen.findByText('npm install -g geneseed')).toBeTruthy()
    expect(within(section('Machine')).queryByRole('button', { name: /^Update/ })).toBeNull()
  })

  // The sheet's index lists the five sections in page order, and each entry is a button that
  // scrolls: a bare href="#server" would be read by the hash router as a page.
  it('indexes its five sections with buttons, not hash links', () => {
    render(<Settings onAction={() => {}} />)
    const nav = screen.getByRole('navigation', { name: 'On this page' })
    expect(
      within(nav)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Appearance', 'Machine', 'Server', 'About', 'Danger zone'])
    expect(within(nav).queryAllByRole('link')).toEqual([])
    for (const name of ['Appearance', 'Machine', 'Server', 'About', 'Danger zone'])
      expect(section(name)).toBeTruthy()
    const scrolled = vi.fn()
    section('Server').scrollIntoView = scrolled
    fireEvent.click(within(nav).getByRole('button', { name: 'Server' }))
    expect(scrolled).toHaveBeenCalledTimes(1)
  })

  // The Maintenance card once had an Uninstall that ran `geneseed uninstall --yes` with no
  // target, so it always removed the OpenCode global whatever install was viewed. Uninstall now
  // lives only on each install's own panel in Hosts; the Danger zone holds what takes something
  // away here (Stop, Remove from PATH) and says where uninstalling lives.
  it('holds Stop and Remove from PATH in the Danger zone, and points to Hosts to uninstall', () => {
    render(<Settings onAction={() => {}} />)
    const danger = section('Danger zone')
    expect(within(danger).getByRole('button', { name: /Stop server/ })).toBeTruthy()
    expect(within(danger).getByRole('button', { name: 'Remove from PATH' })).toBeTruthy()
    expect(within(danger).queryByRole('button', { name: /uninstall/i })).toBeNull()
    expect(within(danger).getByText(/Each install has its own Uninstall in/)).toBeTruthy()
    expect(within(danger).getByRole('link', { name: 'Hosts' }).getAttribute('href')).toBe(
      '#/installs/hosts',
    )
    expect(within(section('Machine')).queryByRole('button', { name: /Stop|Remove/ })).toBeNull()
  })

  // The footprint is changed in ONE place, the install's own panel on Hosts (beside posture and
  // mode, one confirm). Settings shows the viewed install's footprint and links there; it used
  // to carry a second lean/full dial that rebuilt the same install.
  it('shows the footprint read-only and links to Hosts to change it', () => {
    render(
      <Settings
        onAction={() => {}}
        overview={{ install: { host: 'opencode', scope: 'global' }, footprint: 'full' }}
      />,
    )
    const row = screen.getByText('Harness footprint').closest('.sheet-row')
    expect(within(row).queryByRole('button')).toBeNull()
    expect(row.textContent).toContain('full')
    expect(
      within(row)
        .getByRole('link', { name: /Change it on Hosts/ })
        .getAttribute('href'),
    ).toBe('#/installs/hosts')
  })

  const claudeOverview = { install: { host: 'claude', scope: 'global' }, footprint: 'lean' }

  // The page is the Server tab (router.js TAB_LABELS.server), so its heading says so.
  it('titles the view by its tab label, Server', () => {
    render(<Settings onAction={() => {}} overview={claudeOverview} />)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Server')
  })

  it('holds exactly one filled button, Update', () => {
    const { container } = render(<Settings onAction={() => {}} overview={claudeOverview} />)
    const filled = container.querySelectorAll('.btn:not(.ghost)')
    expect(filled).toHaveLength(1)
    expect(filled[0].textContent).toMatch(/Update/)
  })

  it('marks Stop server with the danger line', () => {
    render(<Settings onAction={() => {}} />)
    expect(
      screen.getByRole('button', { name: /Stop server/ }).classList.contains('danger-line'),
    ).toBe(true)
  })

  // The footprint row names the install's tool as the rest of the console does.
  it('names the footprint install by its host label', () => {
    render(<Settings onAction={() => {}} overview={claudeOverview} />)
    const row = screen.getByText('Harness footprint').closest('.sheet-row')
    expect(row.textContent).toContain('Claude Code')
    expect(row.textContent).not.toMatch(/\bclaude ·/)
  })

  // The Server header names the process from /api/overview's `server`: its pid and how long it
  // has run (the clock pinned, so 2 hours before now is "2h"). The Code row reads daemon_stale.
  it('names the running process and says whether its code matches the disk', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-24T12:00:00Z'))
    const started = Date.parse('2026-10-24T10:00:00Z') / 1000
    const server = { pid: 4242, started, autostart: true }
    const { rerender } = render(
      <Settings onAction={() => {}} overview={{ server, daemon_stale: false }} />,
    )
    const head = section('Server').querySelector('.card-head')
    expect(head.textContent).toMatch(/running127\.0\.0\.1:\d+ · pid 4242 · up 2h$/)
    const code = () => within(section('Server')).getByText('Code').closest('.sheet-row')
    expect(code().querySelector('.pill').textContent).toBe('matches disk')
    expect(code().querySelector('.pill').className).toContain('good')
    expect(within(code()).getByRole('button', { name: /Restart server/ })).toBeTruthy()
    expect(within(section('Server')).getByText('On · login script')).toBeTruthy()

    rerender(
      <Settings
        onAction={() => {}}
        overview={{ server: { ...server, autostart: null }, daemon_stale: true }}
      />,
    )
    expect(code().querySelector('.pill').textContent).toBe('disk has newer code → Restart')
    expect(code().querySelector('.pill').className).toContain('warn')
    expect(within(section('Server')).getByText('unknown')).toBeTruthy()
  })

  // The four guards js/web/handler.mjs enforces, each a good pill.
  it('lists the four request guards as good pills', () => {
    render(<Settings onAction={() => {}} />)
    const row = within(section('Server')).getByText('Guards').closest('.sheet-row')
    const pills = [...row.querySelectorAll('.pill')]
    expect(pills.map((p) => p.textContent)).toEqual([
      'Host check',
      'token on writes',
      'framing refused',
      'cross-site GET refused',
    ])
    expect(pills.every((p) => p.classList.contains('good'))).toBe(true)
  })

  // The skin is a segmented control like the Overview view: one button per FLAVOURS entry, in
  // order, the active one pressed; the old preview tiles are gone.
  it('picks the skin from a segmented control, one button per flavour', () => {
    const onFlavour = vi.fn()
    const { container } = render(
      <Settings onAction={() => {}} flavour="cultivar" onFlavour={onFlavour} />,
    )
    const buttons = within(screen.getByRole('group', { name: 'Skin' })).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Cultivar', 'Operator', 'Matrix', 'Atlas'])
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ])
    fireEvent.click(buttons[2])
    expect(onFlavour).toHaveBeenCalledWith('matrix')
    expect(container.querySelector('.dir-tile')).toBeNull()
  })

  // The index shows the server's live state beside its entry: a good dot while the code matches
  // the disk, a warn dot once daemon_stale. The Server section carries the live accent.
  it('marks the Server index entry with a dot that follows daemon_stale', () => {
    const nav = () => screen.getByRole('navigation', { name: 'On this page' })
    const dot = () =>
      within(nav()).getByRole('button', { name: 'Server' }).querySelector('.sheet-dot')
    const { rerender } = render(<Settings onAction={() => {}} overview={{ daemon_stale: false }} />)
    expect(dot().className).toBe('sheet-dot good')
    rerender(<Settings onAction={() => {}} overview={{ daemon_stale: true }} />)
    expect(dot().className).toBe('sheet-dot warn')
    expect(section('Server').classList.contains('sheet-live')).toBe(true)
  })
})
