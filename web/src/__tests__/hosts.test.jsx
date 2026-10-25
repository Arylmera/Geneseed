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
    // In step by default; the Sync tests below hand in their own rows.
    fleet: vi.fn(() =>
      Promise.resolve({
        version: '4.19.0',
        installs: [
          {
            id: 'opencode:global',
            verdict: 'synced',
            diffable: true,
            drift: { edited: 0, added: 0, missing: 0, linked: 0, stale: 0 },
          },
        ],
      }),
    ),
    selectView: vi.fn(() => Promise.resolve({ ok: true })),
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
  // A confirm message may be a React node; its words are read off a detached render.
  const textOf = (node) => {
    const box = document.createElement('div')
    render(<>{node}</>, { container: box })
    return box.textContent
  }

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

  // Rebuild all re-emits every ACTIVE install (rebuild-all), so it asks first and names them;
  // an absent row is not one of them. A declined confirm sends nothing.
  it('Rebuild all names the active installs, then dispatches build-all', async () => {
    askConfirm.mockClear()
    const onAction = vi.fn()
    render(<Hosts onAction={onAction} />)
    fireEvent.click(await screen.findByRole('button', { name: /rebuild all/i }))
    await answered()
    expect(askConfirm).toHaveBeenCalledWith(
      'Rebuild every active install: OpenCode · global? Each is rebuilt in place from source ' +
        'with its own settings; files you edited are kept.',
      { title: 'Rebuild all active installs?', confirmLabel: 'Rebuild all' },
    )
    expect(onAction).toHaveBeenCalledWith('build-all')
  })

  it('a declined Rebuild all sends nothing', async () => {
    askConfirm.mockResolvedValueOnce(false)
    const onAction = vi.fn()
    render(<Hosts onAction={onAction} />)
    fireEvent.click(await screen.findByRole('button', { name: /rebuild all/i }))
    await answered()
    expect(onAction).not.toHaveBeenCalled()
  })

  // A per-project install under `.claude/worktrees/` is a finished worktree's leftover that still
  // lists (its folder is on disk); the row says so, and a normal repo row does not.
  it('flags a project install under .claude/worktrees as a worktree leftover', async () => {
    const proj = (id, p) => ({ id, host: 'claude', scope: 'project', path: p, state: 'active' })
    api.installs.mockImplementationOnce(() =>
      Promise.resolve({
        installs: [
          proj('a', String.raw`C:\git\Geneseed\.claude\worktrees\brainstorm-o3\Harness`),
          proj('b', '/home/u/git/Terra'),
        ],
      }),
    )
    render(<Hosts onAction={() => {}} />)
    const t = await screen.findByRole('table', { name: 'Per-project installs' })
    const tags = [...t.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('.tag')].map((x) => x.textContent),
    )
    expect(tags).toEqual([['Active', 'Worktree leftover'], ['Active']])
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
    expect(screen.getByLabelText('voice for Claude Code · global').value).toBe('imperial')
    // A new install is lean, like the CLI's default, and lean is listed first.
    const fp = screen.getByLabelText('footprint for Claude Code · global')
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
    fireEvent.change(screen.getByLabelText('voice for Claude Code · global'), {
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
    fireEvent.change(screen.getByLabelText('footprint for OpenCode · global'), {
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
    const trust = screen.getByLabelText('trust for OpenCode · global')
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

  it('Uninstall asks a danger confirm, names the layer it deletes, and sends the memory choice', async () => {
    askConfirm.mockClear()
    api.installRemove = vi.fn(async () => ({ ok: true }))
    render(<Hosts onAction={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText('On uninstall, memory and notebook'), {
      target: { value: 'archive' },
    })
    fireEvent.click(screen.getByLabelText('remove OpenCode · global from C:/cfg'))
    await answered()
    const [msg, opts] = askConfirm.mock.calls.at(-1)
    expect(textOf(msg)).toContain(
      "~/.config/opencode's AGENT.md, agents, skills, plugins + the opencode.json entry",
    )
    expect(opts).toMatchObject({ tone: 'danger', confirmLabel: 'Remove' })
    await waitFor(() =>
      expect(api.installRemove).toHaveBeenCalledWith('opencode', 'C:/cfg', 'archive'),
    )
  })

  it('Uninstall names the edited files it kept and the CLI way to delete them', async () => {
    // An edited owned file survives a remove as the user's; a silent success would leave the
    // user believing it was deleted, so the note names it and the --force escape hatch.
    api.installRemove = vi.fn(async () => ({ ok: true, kept: ['.gitignore', 'skills/x/SKILL.md'] }))
    render(<Hosts onAction={vi.fn()} />)
    fireEvent.click(await screen.findByLabelText('remove OpenCode · global from C:/cfg'))
    await answered()
    expect((await screen.findByRole('status')).textContent).toBe(
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
    expect(screen.getByRole('switch', { name: 'activate OpenCode · global' }).checked).toBe(true)
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
    fireEvent.click(await screen.findByRole('switch', { name: 'activate OpenCode · global' }))
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
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open the folder holding global config' }),
    )
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

  // One primary act per view: opening the deploy form adds no second filled button, since
  // its Deploy is secondary beside the panel's Apply and rebuild.
  it('with the deploy form open, holds exactly one filled button', async () => {
    const { container } = render(
      <Hosts onAction={vi.fn()} currentTheme="imperial" themes={[{ name: 'imperial' }]} />,
    )
    fireEvent.click(await screen.findByRole('button', { name: /deploy to a repo/i }))
    expect(container.querySelectorAll('.btn:not(.ghost)')).toHaveLength(1)
  })

  // A host is named the way the table names it, so a label reads "Claude Code · global".
  it('names an install by its host label in accessible names', async () => {
    render(<Hosts onAction={vi.fn()} themes={[{ name: 'neutral' }]} />)
    await pick('Claude Code')
    expect(screen.getByLabelText('voice for Claude Code · global')).toBeTruthy()
  })

  // The install and rebuild questions name the tool by its label and say which loop trust the
  // build takes, since trust is one of the choices the build applies.
  it('the install and rebuild questions name the host label and the loop trust', async () => {
    askConfirm.mockClear()
    render(<Hosts onAction={vi.fn()} currentTheme="imperial" themes={[{ name: 'imperial' }]} />)
    await pick('Claude Code')
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    await answered()
    const install = textOf(askConfirm.mock.calls.at(-1)[0])
    expect(install).toContain('Claude Code')
    expect(install).toContain('balanced loop trust')

    await pick('OpenCode')
    fireEvent.change(within(panel()).getByLabelText(/^footprint for/), {
      target: { value: 'full' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply and rebuild' }))
    await answered()
    const rebuild = textOf(askConfirm.mock.calls.at(-1)[0])
    expect(rebuild).toContain('OpenCode')
    expect(rebuild).toContain('balanced loop trust')
  })

  // Uninstall is a danger confirm, not an inline question: the memory choice stays in the
  // panel, and "delete" makes the confirm name the folder it deletes and say so on its button.
  it('Uninstall asks a danger confirm that names the memory folder it deletes', async () => {
    askConfirm.mockClear()
    api.installRemove = vi.fn(async () => ({ ok: true }))
    render(<Hosts onAction={vi.fn()} />)
    await waitFor(() => expect(panel()).toBeTruthy())
    const memory = await within(panel()).findByLabelText('On uninstall, memory and notebook')
    expect([...memory.options].map((o) => o.value)).toEqual(['keep', 'archive', 'delete'])
    fireEvent.change(memory, { target: { value: 'delete' } })
    fireEvent.click(within(panel()).getByText('Uninstall…'))
    await answered()
    const [msg, opts] = askConfirm.mock.calls.at(-1)
    expect(opts.tone).toBe('danger')
    expect(opts.confirmLabel).toBe('Remove and delete memory')
    expect(textOf(msg)).toContain('C:/cfg/memory')
    await waitFor(() =>
      expect(api.installRemove).toHaveBeenCalledWith('opencode', 'C:/cfg', 'delete'),
    )
  })

  // A Claude-style project install keeps memory under its marker folder (installDataDir in
  // js/maintain/uninstall.mjs), so that is the folder the confirm names, not the repo root.
  it('a Claude project uninstall names the memory under its .claude folder', async () => {
    askConfirm.mockClear()
    api.installRemove = vi.fn(async () => ({ ok: true }))
    vi.mocked(api.installs).mockResolvedValueOnce({
      installs: [
        {
          id: 'claude:C:/git/Terra',
          host: 'claude',
          scope: 'project',
          path: 'C:/git/Terra/',
          state: 'active',
        },
      ],
    })
    render(<Hosts onAction={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText('On uninstall, memory and notebook'), {
      target: { value: 'delete' },
    })
    fireEvent.click(within(panel()).getByText('Uninstall…'))
    await answered()
    const text = textOf(askConfirm.mock.calls.at(-1)[0])
    expect(text).toContain('C:/git/Terra/.claude/memory and C:/git/Terra/.claude/notebook')
  })

  // A Windows path keeps its own separator: C:\git\Terra\.claude\memory, not a mixed one.
  it('a Windows project path names its memory folder with backslashes', async () => {
    askConfirm.mockClear()
    api.installRemove = vi.fn(async () => ({ ok: true }))
    vi.mocked(api.installs).mockResolvedValueOnce({
      installs: [
        {
          id: 'claude:C:/git/Terra',
          host: 'claude',
          scope: 'project',
          path: 'C:\\git\\Terra\\',
          state: 'active',
        },
      ],
    })
    render(<Hosts onAction={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText('On uninstall, memory and notebook'), {
      target: { value: 'delete' },
    })
    fireEvent.click(within(panel()).getByText('Uninstall…'))
    await answered()
    expect(textOf(askConfirm.mock.calls.at(-1)[0])).toContain(
      'C:\\git\\Terra\\.claude\\memory and C:\\git\\Terra\\.claude\\notebook',
    )
  })

  // The memory choice belongs to the install it was made on. With no row picked the panel
  // shows a fallback install, which a refresh can change; a "delete" must not follow it.
  it('a memory choice does not carry to another install the panel falls back to', async () => {
    askConfirm.mockClear()
    api.installRemove = vi.fn(async () => ({ ok: true }))
    const { rerender } = render(<Hosts onAction={vi.fn()} dataRev={0} />)
    fireEvent.change(await screen.findByLabelText('On uninstall, memory and notebook'), {
      target: { value: 'delete' },
    })
    vi.mocked(api.installs).mockResolvedValueOnce({
      installs: [
        {
          id: 'opencode:global',
          host: 'opencode',
          scope: 'global',
          path: 'C:/cfg',
          state: 'disabled',
        },
        {
          id: 'claude:global',
          host: 'claude',
          scope: 'global',
          path: 'C:/.claude',
          state: 'active',
        },
      ],
    })
    rerender(<Hosts onAction={vi.fn()} dataRev={1} />)
    await waitFor(() => expect(panel().querySelector('h2').textContent).toBe('Claude Code'))
    expect(within(panel()).getByLabelText('On uninstall, memory and notebook').value).toBe('keep')
    fireEvent.click(within(panel()).getByText('Uninstall…'))
    await answered()
    expect(askConfirm.mock.calls.at(-1)[1].confirmLabel).toBe('Remove')
    await waitFor(() =>
      expect(api.installRemove).toHaveBeenCalledWith('claude', 'C:/.claude', 'keep'),
    )
  })

  // A failure is an alert; a progress note is a plain status, never painted as an error.
  it('a failed action is an alert, a progress note a plain status', async () => {
    vi.mocked(api.installToggle).mockResolvedValueOnce({ ok: false, error: 'toggle failed: busy' })
    render(<Hosts onAction={() => {}} />)
    fireEvent.click(await screen.findByRole('switch', { name: /activate/ }))
    await answered()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('toggle failed: busy')
    expect(alert.className).toContain('tag')
    expect(alert.className).toContain('bad')

    fireEvent.click(screen.getByRole('button', { name: /Open the folder holding|Open folder/ }))
    const status = await screen.findByText(/Opening C:\/cfg/)
    expect(status.getAttribute('role')).toBe('status')
    expect(status.className).not.toContain('bad')
  })

  // A host with no MCP file (Bob's settings file not written yet) says so, and offers no
  // folder to open, since there is no file in it to edit.
  it('a missing MCP file says so and offers no Open folder', async () => {
    vi.mocked(api.installs).mockResolvedValueOnce({
      installs: [
        { id: 'bob:global', host: 'bob', scope: 'global', path: 'C:/.bob', state: 'active' },
      ],
    })
    vi.mocked(api.mcp).mockResolvedValueOnce({
      targets: [
        {
          label: 'global config',
          path: 'C:/.bob/settings.json',
          host: 'bob',
          root: 'C:/.bob',
          exists: false,
          commented: false,
          servers: [],
        },
      ],
      default: 0,
    })
    render(<Hosts onAction={() => {}} />)
    await waitFor(() => expect(within(panel()).getByText(/No MCP file yet/)).toBeTruthy())
    expect(within(panel()).queryByRole('button', { name: /open/i })).toBeNull()
  })

  // Icon-row buttons carry what they act on in their accessible name, and an exclusion's
  // hosts read as the tool labels the table uses.
  it('names the Open folder and exclusion Remove buttons by their target', async () => {
    vi.mocked(api.excludes).mockResolvedValueOnce({
      excludes: [{ path: 'C:/git/Terra', hosts: ['claude'] }],
      installs: [{ host: 'claude', cfg: '/x' }],
    })
    render(<Hosts onAction={() => {}} />)
    expect(
      await screen.findByRole('button', { name: 'Open the folder holding global config' }),
    ).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Stop excluding C:/git/Terra' })).toBeTruthy()
    expect(screen.getByText('C:/git/Terra').parentElement.textContent).toContain('Claude Code')
    expect(screen.queryByText('[claude]')).toBeNull()
  })

  // An empty folder is the form's own error, next to the field it is about, not the page note.
  it('the deploy form flags an empty folder inline, not in the page note', async () => {
    render(<Hosts onAction={vi.fn()} currentTheme="imperial" themes={[{ name: 'imperial' }]} />)
    fireEvent.click(await screen.findByRole('button', { name: /deploy to a repo/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Deploy' }))
    const input = screen.getByLabelText('Folder to deploy into')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/folder/i)
    expect(input.closest('.deploy-pop').contains(alert)).toBe(true)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(screen.queryAllByRole('status').filter((s) => /folder/i.test(s.textContent))).toEqual([])
  })

  // "Sync with source", from /api/fleet joined by id. The verdict gives the headline: behind
  // names the source release and the stale files (one file is singular), in step is "In sync",
  // no marker is "Not checked". Hand edits (edited + added) are counted apart and never summed
  // into the stale count; a row with no drift check says "not checkable"; a row the fleet does not
  // list (not installed) says "—". A null release label reads "Behind source".
  describe('Sync with source', () => {
    const four = [
      ['oc', 'opencode', 'global', 'C:/oc'],
      ['cl', 'claude', 'global', 'C:/cl'],
      ['bo', 'bob', 'global', 'C:/bo'],
      ['ocl', 'openclaude', 'global', 'C:/ocl'],
    ].map(([id, host, scope, path]) => ({ id, host, scope, path, state: 'active' }))
    const drift = (stale, edited = 0, added = 0) => ({
      edited,
      added,
      missing: 0,
      linked: 0,
      stale,
    })
    // The cell's words, without the bar (its legend repeats the counts for sighted readers).
    const syncOf = (name) => {
      const td = screen.getByRole('button', { name }).closest('tr').querySelector('td:nth-child(6)')
      const copy = td.cloneNode(true)
      copy.querySelector('.stackbar-box')?.remove()
      return copy.textContent
    }

    it('names each verdict in words, with hand edits apart from stale files', async () => {
      api.installs.mockResolvedValueOnce({
        installs: [
          ...four,
          { id: 'x', host: 'opencode', scope: 'project', path: 'C:/p/Repo', state: 'absent' },
        ],
      })
      api.fleet.mockResolvedValueOnce({
        version: '4.19.0',
        installs: [
          { id: 'oc', verdict: 'behind', diffable: true, drift: drift(3, 1, 1) },
          { id: 'cl', verdict: 'synced', diffable: true, drift: drift(0) },
          { id: 'bo', verdict: 'behind', diffable: true, drift: drift(1) },
          { id: 'ocl', verdict: 'unknown', diffable: false, drift: null },
        ],
      })
      render(<Hosts onAction={() => {}} />)
      await waitFor(() => expect(syncOf('OpenCode')).toContain('Behind'))
      expect(syncOf('OpenCode')).toBe('Behind 4.19.0 · 3 files · 2 edited Local edits')
      expect(syncOf('Claude Code')).toBe('In sync')
      expect(syncOf('BOB (IBM)')).toBe('Behind 4.19.0 · 1 file')
      expect(syncOf('OpenClaude')).toBe('Not checked · not checkable')
      expect(syncOf('Repo')).toBe('—')
      // The bar reads its two parts, so colour is not the only carrier.
      expect(
        screen
          .getByRole('img', { name: /Sync with source of OpenCode/ })
          .getAttribute('aria-label'),
      ).toBe('Sync with source of OpenCode: behind source: 3 of 5, edited by hand: 2 of 5')
    })

    it('a behind row with no drift figure and no release label still says it is behind', async () => {
      api.installs.mockResolvedValueOnce({ installs: [four[0]] })
      api.fleet.mockResolvedValueOnce({
        version: null,
        installs: [{ id: 'oc', verdict: 'behind', diffable: false, drift: null }],
      })
      render(<Hosts onAction={() => {}} />)
      await waitFor(() => expect(syncOf('OpenCode')).toBe('Behind source · not checkable'))
    })

    it('a failed fleet blanks only the Sync cells, never the tables', async () => {
      api.fleet.mockRejectedValueOnce(new Error('fleet down'))
      render(<Hosts onAction={() => {}} />)
      await waitFor(() => expect(syncOf('OpenCode')).toBe('—'))
      expect(document.querySelectorAll('.hosts-tbl tbody tr')).toHaveLength(2)
      expect(screen.queryByRole('alert')).toBeNull()
    })

    // Local edits diffs the VIEWED install only: another row's link moves the view, then the
    // app refreshes, and only then does the hash change. The viewed row skips the move.
    it('Local edits moves the view before the hash, and only for another install', async () => {
      const order = []
      api.selectView.mockClear()
      api.selectView.mockImplementationOnce(async (host, path) => {
        order.push(`view ${host} ${path} at ${window.location.hash || '(none)'}`)
        return { ok: true }
      })
      const onMutated = vi.fn(() => order.push('refresh'))
      api.installs.mockResolvedValueOnce({
        installs: [{ ...four[0] }, { ...four[1], selected: true }],
      })
      api.fleet.mockResolvedValueOnce({
        version: '4.19.0',
        installs: [
          { id: 'oc', verdict: 'synced', diffable: true, drift: drift(0, 2) },
          { id: 'cl', verdict: 'synced', diffable: true, drift: drift(0, 1) },
        ],
      })
      window.location.hash = '#/installs/hosts'
      render(<Hosts onAction={() => {}} onMutated={onMutated} />)
      const links = await screen.findAllByRole('link', { name: 'Local edits' })
      fireEvent.click(links[0])
      await waitFor(() => expect(window.location.hash).toBe('#/installs/edits'))
      expect(order).toEqual(['view opencode C:/oc at #/installs/hosts', 'refresh'])
      // The click did not also pick the row.
      expect(panel().querySelector('h2').textContent).toBe('Claude Code')

      window.location.hash = '#/installs/hosts'
      fireEvent.click(links[1])
      await waitFor(() => expect(window.location.hash).toBe('#/installs/edits'))
      expect(api.selectView).toHaveBeenCalledTimes(1)
    })
  })
})
