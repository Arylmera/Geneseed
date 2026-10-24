import React from 'react'
import { act, render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../api/index.js', () => ({
  api: {
    installs: vi.fn(() =>
      Promise.resolve({
        installs: [
          {
            id: 'opencode:global',
            host: 'opencode',
            scope: 'global',
            path: 'C:/cfg',
            state: 'active',
          },
          {
            id: 'claude:global',
            host: 'claude',
            scope: 'global',
            path: 'C:/.claude',
            state: 'absent',
            // What `/api/installs` really says for an absent row (`footprintOfDir` with no
            // marker), which the page must not take as this new install's footprint.
            footprint: 'full',
          },
        ],
      }),
    ),
    installToggle: vi.fn(() => Promise.resolve({ ok: true })),
    mcp: vi.fn(() =>
      Promise.resolve({
        targets: [
          {
            label: 'global config',
            path: 'C:/cfg/opencode.json',
            host: 'opencode',
            root: 'C:/cfg',
            exists: true,
            commented: false,
            servers: [{ name: 'markitdown', state: 'enabled' }],
          },
        ],
        default: 0,
      }),
    ),
    mcpReveal: vi.fn(() => Promise.resolve({ ok: true, dir: 'C:/cfg' })),
    excludes: vi.fn(() =>
      Promise.resolve({ excludes: [], installs: [{ host: 'claude', cfg: '/x' }] }),
    ),
    excludeMutate: vi.fn(() => Promise.resolve({ ok: true, path: '/y', messages: [] })),
  },
}))

// Every confirm answers yes, and the questions a page asked are read off
// `askConfirm.mock.calls` (hooks/useConfirm.jsx; its own dialog is tested in useConfirm.test).
const { askConfirm } = vi.hoisted(() => ({ askConfirm: vi.fn(async () => true) }))
vi.mock('../hooks/useConfirm.jsx', () => ({ useConfirm: () => askConfirm }))
// The confirm is a promise, so the action behind it lands a microtask after the click.
const answered = () => act(async () => {})

import Hosts from '../pages/Installs/Hosts.jsx'
import { Switch } from '../pages/Installs/controls.jsx'
import { api } from '../api/index.js'

// Installs / Hosts: the install table, and the picked install in a side panel. The panel
// opens on the install the console is viewing, else the first active one, else the first.
const pick = async (label) =>
  fireEvent.click(await screen.findByRole('button', { name: label, pressed: false }))
const panel = () => document.querySelector('.install-panel')

describe('Installs / Hosts', () => {
  it('lists each global install by its tool, with its state, and a Rebuild all button', async () => {
    render(<Hosts onAction={() => {}} />)
    await waitFor(() => expect(document.querySelectorAll('.hosts-tbl tbody tr')).toHaveLength(2))
    const rows = [...document.querySelectorAll('.hosts-tbl tbody tr')].map((tr) => [
      tr.querySelector('.row-pick').textContent,
      tr.querySelector('.tag').textContent,
    ])
    // Active before absent. A global row is named by its tool: there is one per tool.
    expect(rows).toEqual([
      ['OpenCode', 'Active'],
      ['Claude Code', 'Not installed'],
    ])
    expect(screen.getByRole('button', { name: /rebuild all/i })).toBeTruthy()
  })

  // Global and per-project installs are two tables, not one mixed list: a global row is
  // named by its tool, a project row by its folder with the tool beside it, and with no
  // project installs the second table says so instead of rendering empty.
  it('splits global and per-project installs into two tables', async () => {
    api.installs.mockImplementationOnce(() =>
      Promise.resolve({
        installs: [
          {
            id: 'opencode:global',
            host: 'opencode',
            scope: 'global',
            path: 'C:/cfg',
            state: 'active',
          },
          {
            id: 'claude:C:/git/Terra',
            host: 'claude',
            scope: 'project',
            path: 'C:\\git\\Terra\\',
            state: 'active',
            theme: 'imperial',
          },
        ],
      }),
    )
    render(<Hosts onAction={() => {}} />)
    const table = (name) => screen.findByRole('table', { name })
    const names = (t) => [...t.querySelectorAll('.row-pick')].map((b) => b.textContent)
    expect(names(await table('Global installs'))).toEqual(['OpenCode'])
    const proj = await table('Per-project installs')
    expect(names(proj)).toEqual(['Terra'])
    expect(proj.querySelector('tbody td:nth-child(2)').textContent).toBe('Claude Code')
  })

  it('says so when no repo has its own harness', async () => {
    render(<Hosts onAction={() => {}} />)
    expect(await screen.findByText(/No repo has its own harness yet/)).toBeTruthy()
    expect(screen.queryByRole('table', { name: 'Per-project installs' })).toBeNull()
  })

  // The table and the panel are one control: the whole row selects (not only the name),
  // the selected row says it is the one being edited, and the panel says it shows the
  // selection, by the same name the table uses and with its kind.
  it('selects an install by clicking anywhere on its row, and the panel follows', async () => {
    render(<Hosts onAction={() => {}} />)
    await waitFor(() => expect(panel()).toBeTruthy())
    const row = (await screen.findByRole('button', { name: 'Claude Code' })).closest('tr')
    fireEvent.click(row.querySelector('.path-cell'))
    expect(panel().querySelector('h2').textContent).toBe('Claude Code')
    expect(panel().querySelector('.ip-eyebrow').textContent).toBe('Selected install')
    expect(panel().querySelector('.ip-kind').textContent).toBe('Global install')
    expect(row.querySelector('.pick-mark').textContent).toBe('Editing ›')
    expect([...document.querySelectorAll('.pick-mark')].filter((c) => c.textContent).length).toBe(1)
  })

  it('Rebuild all dispatches the build-all action', async () => {
    const onAction = vi.fn()
    render(<Hosts onAction={onAction} />)
    fireEvent.click(await screen.findByRole('button', { name: /rebuild all/i }))
    expect(onAction).toHaveBeenCalledWith('build-all')
  })

  it('opens the panel on the active install', async () => {
    render(<Hosts onAction={() => {}} />)
    await waitFor(() => expect(panel()).toBeTruthy())
    expect(panel().querySelector('h2').textContent).toBe('OpenCode')
    expect(screen.getByRole('button', { name: 'OpenCode', pressed: true })).toBeTruthy()
  })

  it('installs a picked absent host, the voice defaulting to the deployed one', async () => {
    const onAction = vi.fn()
    render(
      <Hosts
        onAction={onAction}
        currentTheme="imperial"
        themes={[{ name: 'neutral' }, { name: 'imperial' }]}
      />,
    )
    await pick('Claude Code')
    expect(panel().querySelector('h2').textContent).toBe('Claude Code')
    // The four choices are there, the voice on the deployed one.
    expect(screen.getByLabelText('voice for claude · global').value).toBe('imperial')
    // A new install is lean, like the CLI's default, and lean is listed first.
    const fp = screen.getByLabelText('footprint for claude · global')
    expect(fp.value).toBe('lean')
    expect([...fp.options].map((o) => o.value)).toEqual(['lean', 'full'])
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    await answered()
    // The table-row install's seven fields, plus the loop trust preset at its default.
    expect(onAction).toHaveBeenCalledWith('install', {
      host: 'claude',
      scope: 'global',
      path: 'C:/.claude',
      theme: 'imperial',
      footprint: 'lean',
      posture: 'peer',
      mode: 'direct',
      trust: 'balanced',
    })
  })

  it('the voice picker changes the install theme', async () => {
    const onAction = vi.fn()
    render(
      <Hosts
        onAction={onAction}
        currentTheme="imperial"
        themes={[{ name: 'neutral' }, { name: 'imperial' }]}
      />,
    )
    await pick('Claude Code')
    fireEvent.change(screen.getByLabelText('voice for claude · global'), {
      target: { value: 'neutral' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    await answered()
    expect(onAction).toHaveBeenCalledWith('install', expect.objectContaining({ theme: 'neutral' }))
  })

  it('Apply and rebuild stays disabled until a choice actually changes', async () => {
    vi.mocked(api.installs).mockResolvedValueOnce({
      installs: [
        {
          id: 'opencode:global',
          host: 'opencode',
          scope: 'global',
          path: 'C:/cfg',
          state: 'active',
          theme: 'neutral',
          footprint: 'lean',
          posture: 'peer',
          mode: 'direct',
        },
      ],
      postures: ['peer'],
      modes: ['direct'],
    })
    const onAction = vi.fn()
    render(<Hosts onAction={onAction} themes={[{ name: 'neutral' }, { name: 'imperial' }]} />)
    const apply = await screen.findByRole('button', { name: 'Apply and rebuild' })
    expect(apply.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('footprint for opencode · global'), {
      target: { value: 'full' },
    })
    expect(apply.disabled).toBe(false)
    fireEvent.click(apply)
    await answered()
    expect(onAction).toHaveBeenCalledWith(
      'install',
      expect.objectContaining({ host: 'opencode', footprint: 'full', theme: 'neutral' }),
    )
  })

  it('the loop trust picker lists the presets and rebuilds with the picked one', async () => {
    vi.mocked(api.installs).mockResolvedValueOnce({
      installs: [
        {
          id: 'opencode:global',
          host: 'opencode',
          scope: 'global',
          path: 'C:/cfg',
          state: 'active',
          theme: 'neutral',
          footprint: 'lean',
          posture: 'peer',
          mode: 'direct',
          trust: 'balanced',
        },
      ],
      postures: ['peer'],
      modes: ['direct'],
      trusts: ['prudent', 'balanced', 'aggressive'],
    })
    const onAction = vi.fn()
    render(<Hosts onAction={onAction} themes={[{ name: 'neutral' }]} />)
    const apply = await screen.findByRole('button', { name: 'Apply and rebuild' })
    const trust = screen.getByLabelText('trust for opencode · global')
    expect(trust.value).toBe('balanced')
    expect([...trust.options].map((o) => o.value)).toEqual(['prudent', 'balanced', 'aggressive'])
    expect(apply.disabled).toBe(true)
    fireEvent.change(trust, { target: { value: 'prudent' } })
    expect(apply.disabled).toBe(false)
    fireEvent.click(apply)
    await answered()
    expect(onAction).toHaveBeenCalledWith(
      'install',
      expect.objectContaining({ host: 'opencode', trust: 'prudent' }),
    )
  })

  it('deploys to a folder with the picked host, naming what that host adds', async () => {
    const onAction = vi.fn(async () => 'job-1')
    render(<Hosts onAction={onAction} currentTheme="imperial" themes={[{ name: 'imperial' }]} />)
    fireEvent.click(await screen.findByRole('button', { name: /deploy to a repo/i }))
    // Default host: the active install's (opencode here), and its note says what it adds.
    const host = screen.getByLabelText('host for the new harness')
    expect(host.value).toBe('opencode')
    expect(document.querySelector('.dp-note code').textContent).toBe('.opencode/ + AGENT.md')
    fireEvent.change(host, { target: { value: 'claude' } })
    expect(document.querySelector('.dp-note code').textContent).toBe('.claude/ + CLAUDE.md')
    fireEvent.change(screen.getByLabelText('Folder to deploy into'), {
      target: { value: ' C:/proj ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Deploy' }))
    await answered()
    expect(onAction).toHaveBeenCalledWith('deploy', {
      host: 'claude',
      path: 'C:/proj',
      theme: 'imperial',
      footprint: 'lean',
      posture: 'peer',
      mode: 'direct',
      trust: 'balanced',
    })
    // An accepted job closes the form.
    expect(screen.queryByLabelText('Folder to deploy into')).toBeNull()
  })

  it('a deploy defaults to lean, and an explicit full is sent as full', async () => {
    const onAction = vi.fn(async () => 'job-1')
    render(<Hosts onAction={onAction} currentTheme="imperial" themes={[{ name: 'imperial' }]} />)
    fireEvent.click(await screen.findByRole('button', { name: /deploy to a repo/i }))
    const fp = screen.getByLabelText('footprint for the new harness')
    expect(fp.value).toBe('lean')
    expect([...fp.options].map((o) => o.value)).toEqual(['lean', 'full'])
    fireEvent.change(fp, { target: { value: 'full' } })
    fireEvent.change(screen.getByLabelText('Folder to deploy into'), {
      target: { value: 'C:/proj' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Deploy' }))
    await answered()
    expect(onAction).toHaveBeenCalledWith('deploy', expect.objectContaining({ footprint: 'full' }))
  })

  it('Uninstall asks inline, names the layer it deletes, and sends the memory choice', async () => {
    api.installRemove = vi.fn(async () => ({ ok: true }))
    render(<Hosts onAction={vi.fn()} />)
    fireEvent.click(await screen.findByLabelText('remove opencode · global from C:/cfg'))
    expect(document.querySelector('.h-remove code').textContent).toBe(
      "~/.config/opencode's AGENT.md, agents, skills, plugins + the opencode.json entry",
    )
    fireEvent.change(screen.getByLabelText('memory disposition'), {
      target: { value: 'archive' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await answered()
    expect(api.installRemove).toHaveBeenCalledWith('opencode', 'C:/cfg', 'archive')
  })

  it('Uninstall names the edited files it kept and the CLI way to delete them', async () => {
    // An edited owned file survives a remove as the user's; a silent success would leave the
    // user believing it was deleted, so the note names it and the --force escape hatch.
    api.installRemove = vi.fn(async () => ({ ok: true, kept: ['.gitignore', 'skills/x/SKILL.md'] }))
    render(<Hosts onAction={vi.fn()} />)
    fireEvent.click(await screen.findByLabelText('remove opencode · global from C:/cfg'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await answered()
    expect(screen.getByRole('status').textContent).toBe(
      'Removed. Kept 2 file(s) you edited: .gitignore, skills/x/SKILL.md — they are yours now ' +
        '(the CLI geneseed uninstall --force deletes edited files too).',
    )
  })

  it('an absent install offers no switch and no Uninstall', async () => {
    render(<Hosts onAction={() => {}} />)
    await pick('Claude Code')
    expect(within(panel()).queryByRole('switch')).toBeNull()
    expect(within(panel()).queryByText('Uninstall…')).toBeNull()
  })

  it('the voice reference is closed, offers nothing to apply, and pins the deployed voice', async () => {
    const onAction = vi.fn()
    render(
      <Hosts
        onAction={onAction}
        overview={{ theme: 'neutral' }}
        themes={[
          { name: 'imperial', tagline: 'for the Emperor', blurb: '' },
          { name: 'neutral', tagline: 'plain', blurb: '' },
        ]}
      />,
    )
    await waitFor(() => expect(document.querySelector('.voice-ref')).toBeTruthy())
    const details = document.querySelector('.voice-ref')
    expect(details.open).toBe(false)
    expect(within(details).queryAllByRole('button')).toEqual([])
    details.open = true
    const rows = document.querySelectorAll('.voice-row')
    expect(rows[0].className).toContain('current')
    expect(within(rows[0]).getByText('neutral')).toBeTruthy()
    expect(onAction).not.toHaveBeenCalled()
  })

  it('draws no voice reference until the overview lands', async () => {
    render(<Hosts onAction={() => {}} themes={[{ name: 'neutral', tagline: 'plain' }]} />)
    await waitFor(() => expect(panel()).toBeTruthy())
    expect(document.querySelector('.voice-ref')).toBeNull()
  })

  it('shows the active install’s switch on, and its MCP servers read-only', async () => {
    render(<Hosts onAction={() => {}} />)
    await waitFor(() => expect(screen.getByText('markitdown')).toBeTruthy())
    expect(screen.getByRole('switch', { name: 'activate opencode · global' }).checked).toBe(true)
    expect(screen.getByText('Enabled')).toBeTruthy()
    // Read-only: the install switch is the panel's only switch, and nothing offers to Add.
    expect(screen.getAllByRole('switch')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull()
  })

  // The counterpart of scopedRefresh.test: an install toggle changes install state, so it
  // still asks App for the app-wide refresh (overview + every panel), once.
  it('an install toggle still triggers the app-wide refresh', async () => {
    const onMutated = vi.fn()
    render(<Hosts onAction={() => {}} onMutated={onMutated} />)
    fireEvent.click(await screen.findByRole('switch', { name: 'activate opencode · global' }))
    await answered()
    await waitFor(() =>
      expect(api.installToggle).toHaveBeenCalledWith('opencode', 'C:/cfg', 'deactivate'),
    )
    await waitFor(() => expect(onMutated).toHaveBeenCalledTimes(1))
  })

  it('says so when a config holds no MCP server, rather than offering one', async () => {
    vi.mocked(api.mcp).mockResolvedValueOnce({
      targets: [
        {
          label: 'global config',
          path: 'C:/cfg/opencode.json',
          host: 'opencode',
          root: 'C:/cfg',
          exists: true,
          commented: false,
          servers: [],
        },
      ],
      default: 0,
    })
    render(<Hosts onAction={() => {}} themes={[{ name: 'neutral' }]} />)
    await waitFor(() => expect(screen.getByText('None configured in this file.')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull()
  })

  it('the Open folder button reveals the config the servers live in', async () => {
    render(<Hosts onAction={() => {}} themes={[{ name: 'neutral' }]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open folder' }))
    // THE TARGET'S CONFIG PATH, not the install root: the server's allowlist is keyed on
    // the config path it listed, so sending the root would 404 every time.
    await waitFor(() => expect(api.mcpReveal).toHaveBeenCalledWith('C:/cfg/opencode.json'))
    // The note NAMES THE FOLDER instead of claiming a window opened.
    await waitFor(() => expect(screen.getByText(/Opening C:\/cfg/)).toBeTruthy())
  })

  it('pairs MCP with a CLAUDE install by (host, root), not by the config dirname', async () => {
    vi.mocked(api.installs).mockResolvedValueOnce({
      installs: [
        {
          id: 'claude:global',
          host: 'claude',
          scope: 'global',
          path: '/home/u/.claude',
          state: 'active',
          theme: 'neutral',
        },
      ],
    })
    vi.mocked(api.mcp).mockResolvedValueOnce({
      targets: [
        {
          label: 'global config',
          path: '/home/u/.claude.json', // dirname is /home/u, NOT the install root
          host: 'claude',
          root: '/home/u/.claude',
          exists: true,
          commented: false,
          servers: [
            { name: 'markitdown', state: 'enabled' },
            { name: 'gitlab', state: 'disabled' },
          ],
        },
      ],
      default: 0,
    })
    render(<Hosts onAction={() => {}} themes={[{ name: 'neutral' }]} />)
    await waitFor(() => expect(screen.getByText('markitdown')).toBeTruthy())
    expect(screen.getByText('gitlab')).toBeTruthy()
    expect(screen.getByText('Disabled')).toBeTruthy()
  })

  it('shows the excluded folders of an active global install', async () => {
    render(<Hosts onAction={() => {}} />)
    await waitFor(() => expect(screen.getByText('Excluded folders')).toBeTruthy())
  })

  it('Switch: Enter toggles when enabled, does nothing when disabled', () => {
    // Native `disabled` already blocks click/Space/focus; the hand-rolled Enter path is the
    // one keydown handler that bypassed it.
    const onToggle = vi.fn()
    const { rerender } = render(
      <Switch on={false} disabled={false} label="activate x" onToggle={onToggle} />,
    )
    fireEvent.keyDown(screen.getByRole('switch'), { key: 'Enter' })
    expect(onToggle).toHaveBeenCalledTimes(1)

    rerender(<Switch on={false} disabled={true} label="activate x" onToggle={onToggle} />)
    fireEvent.keyDown(screen.getByRole('switch'), { key: 'Enter' })
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
