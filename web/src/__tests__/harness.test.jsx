import React from 'react'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
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
            servers: [
              {
                name: 'markitdown',
                label: 'MarkItDown',
                desc: 'docs',
                preset: true,
                state: 'enabled',
              },
            ],
          },
        ],
        default: 0,
      }),
    ),
    mcpToggle: vi.fn(() => Promise.resolve({ ok: true })),
    mcpReveal: vi.fn(() => Promise.resolve({ ok: true, dir: 'C:/cfg' })),
    excludes: vi.fn(() =>
      Promise.resolve({ excludes: [], installs: [{ host: 'claude', cfg: '/x' }] }),
    ),
    excludeMutate: vi.fn(() => Promise.resolve({ ok: true, path: '/y', messages: [] })),
  },
}))

import Harness, { Switch } from '../pages/Harness.jsx'
import { api } from '../api/index.js'

describe('Harness', () => {
  it('lists each install (host · scope) and a Rebuild all button', async () => {
    render(<Harness onAction={() => {}} />)
    await waitFor(() => expect(screen.getAllByText(/global/).length).toBeGreaterThan(0))
    // both the active OpenCode and the absent Claude rows render
    expect(screen.getAllByText(/opencode/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/claude/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /rebuild all/i })).toBeTruthy()
  })

  it('Rebuild all dispatches the build-all action', async () => {
    const onAction = vi.fn()
    render(<Harness onAction={onAction} />)
    const btn = await screen.findByRole('button', { name: /rebuild all/i })
    fireEvent.click(btn)
    expect(onAction).toHaveBeenCalledWith('build-all')
  })

  it('discloses the install steps before dispatching, and defaults the voice to the deployed one', async () => {
    const onAction = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <Harness
        onAction={onAction}
        currentTheme="imperial"
        themes={[{ name: 'neutral' }, { name: 'imperial' }]}
      />,
    )
    // An absent row shows ONE control, not four selects and a button. THE DISCLOSURE IS THE
    // ASSERTION: before it is opened there is no voice picker for this row at all, which is
    // the whole change — a machine with three uninstalled hosts used to render twelve
    // dropdowns for choices nobody had asked to make.
    const open = await screen.findByRole('button', { name: 'Install…' })
    expect(screen.queryByLabelText('voice for claude · global')).toBeNull()
    fireEvent.click(open)
    // Opened, the four steps are there and the voice defaults to the deployed one.
    expect(screen.getByLabelText('voice for claude · global')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    // The PAYLOAD IS UNCHANGED from the inline lane this replaced — same action, same six
    // fields, same defaults. Only the moment the user is asked has moved.
    expect(onAction).toHaveBeenCalledWith('install', {
      host: 'claude',
      scope: 'global',
      path: 'C:/.claude',
      theme: 'imperial',
      footprint: 'full',
      posture: 'peer',
      mode: 'direct',
    })
  })

  it('the disclosed voice picker changes the install theme', async () => {
    const onAction = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <Harness
        onAction={onAction}
        currentTheme="imperial"
        themes={[{ name: 'neutral' }, { name: 'imperial' }]}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Install…' }))
    const select = screen.getByLabelText('voice for claude · global')
    fireEvent.change(select, { target: { value: 'neutral' } })
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(onAction).toHaveBeenCalledWith('install', expect.objectContaining({ theme: 'neutral' }))
  })

  it('renders this machine’s install as the first card, from the overview', async () => {
    render(
      <Harness
        onAction={() => {}}
        overview={{
          install: { host: 'opencode', scope: 'global', path: 'C:/cfg' },
          theme: 'imperial',
          footprint: 'lean',
          build_time: '2026-08-23 16:09',
        }}
      />,
    )
    // The four facts the prototype's first card states, and they come from the OVERVIEW —
    // not from the installs table below, which does not carry the footprint or the build.
    // Scoped to the card's own key/value row: "lean" is also an <option> in the table's
    // footprint picker, and an unscoped match would pass on the wrong element.
    await waitFor(() => expect(screen.getByText('2026-08-23 16:09')).toBeTruthy())
    const fpRow = screen.getByText('footprint').closest('.kv')
    expect(within(fpRow).getByText('lean')).toBeTruthy()
    expect(within(screen.getByText('voice').closest('.kv')).getByText('imperial')).toBeTruthy()
  })

  it('carries the retired Themes tab as a reference, closed and with nothing to apply', async () => {
    const onAction = vi.fn()
    render(
      <Harness
        onAction={onAction}
        currentTheme="neutral"
        overview={{ theme: 'neutral', emit: 'opencode-global' }}
        themes={[
          { name: 'neutral', tagline: 'plain', blurb: '' },
          { name: 'imperial', tagline: 'for the Emperor', blurb: '' },
        ]}
      />,
    )
    // Scoped, not `getByText('Voice')`: the install table below has a Voice COLUMN, and an
    // unscoped match would resolve to whichever came first in the DOM.
    await waitFor(() => expect(document.querySelector('.voice-ref')).toBeTruthy())
    const details = document.querySelector('.voice-ref')
    expect(within(details).getByText('Voice')).toBeTruthy()
    // CLOSED BY DEFAULT. The install card above already states the deployed voice, so this
    // is something you open when choosing — not a wall of prose on every visit.
    expect(details.open).toBe(false)
    expect(screen.getByText(/2 to choose from/)).toBeTruthy()

    // ⚠ THE POINT OF THE CHANGE: the reference offers no way to act. Voice is picked per
    // install in the table below, beside that install's own footprint, posture and mode —
    // a gallery at the top of the page could only ever have acted on ONE of them, which is
    // what made "Apply voice" here and "Apply" on a row two different things.
    expect(screen.queryByRole('button', { name: /apply voice/i })).toBeNull()
    expect(within(details).queryAllByRole('button')).toEqual([])

    // Opened, it is what a bare <select> of names cannot be: the taglines, with the
    // deployed voice marked and pinned first.
    details.open = true
    expect(screen.getByText('“for the Emperor”')).toBeTruthy()
    const rows = document.querySelectorAll('.voice-row')
    expect(rows[0].className).toContain('current')
    expect(within(rows[0]).getByText('neutral')).toBeTruthy()
    expect(onAction).not.toHaveBeenCalled()
  })

  it('renders switch toggles for the active install and its nested MCP servers', async () => {
    render(<Harness onAction={() => {}} />)
    // The active OpenCode row carries its own install switch, on by default.
    await waitFor(() => expect(screen.getAllByRole('switch').length).toBeGreaterThan(0))
    const switches = screen.getAllByRole('switch')
    expect(switches.some((s) => s.getAttribute('aria-checked') === 'true')).toBe(true)
    // Its MCP servers (under C:/cfg/opencode.json) are nested in the row, shown by default.
    expect(screen.getByText('MarkItDown')).toBeTruthy()
  })

  it('collapses and re-expands an active row’s MCP wiring via the chevron', async () => {
    render(<Harness onAction={() => {}} />)
    await waitFor(() => expect(screen.getByText('MarkItDown')).toBeTruthy())
    const chevron = screen.getByRole('button', { name: /collapse MCP for opencode/i })
    fireEvent.click(chevron)
    expect(screen.queryByText('MarkItDown')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /expand MCP for opencode/i }))
    expect(screen.getByText('MarkItDown')).toBeTruthy()
  })

  it('renders an Add button for absent preset MCP servers nested under their active harness', async () => {
    vi.mocked(api.mcp).mockResolvedValueOnce({
      targets: [
        {
          label: 'global config',
          path: 'C:/cfg/opencode.json',
          host: 'opencode',
          root: 'C:/cfg',
          exists: true,
          commented: false,
          servers: [
            { name: 'context7', label: 'Context7', desc: 'docs', preset: true, state: 'absent' },
            { name: 'custom-srv', label: 'Custom', desc: 'custom', preset: false, state: 'absent' },
          ],
        },
      ],
      default: 0,
    })
    // The install owning the MCP target must be active for it to nest (api_mcp's own contract).
    vi.mocked(api.installs).mockResolvedValueOnce({
      installs: [
        {
          id: 'opencode:global',
          host: 'opencode',
          scope: 'global',
          path: 'C:/cfg',
          state: 'active',
          theme: 'neutral',
        },
      ],
    })
    render(<Harness onAction={() => {}} themes={[{ name: 'neutral' }]} />)
    // Absent preset → Add button; absent non-preset → nothing. One Add in total.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy())
    expect(screen.getAllByRole('button', { name: 'Add' }).length).toBe(1)
  })

  it('the Open folder button reveals the config the tokens actually go into', async () => {
    // The gap this closes: a preset lands with GITLAB_PERSONAL_ACCESS_TOKEN and GITLAB_API_URL
    // blank, and the screen named the file but could not take you to it.
    vi.mocked(api.installs).mockResolvedValueOnce({
      installs: [
        {
          id: 'opencode:global',
          host: 'opencode',
          scope: 'global',
          path: 'C:/cfg',
          state: 'active',
          theme: 'neutral',
        },
      ],
    })
    render(<Harness onAction={() => {}} themes={[{ name: 'neutral' }]} />)
    const btn = await waitFor(() => screen.getByRole('button', { name: 'Open folder' }))
    fireEvent.click(btn)
    // THE TARGET'S CONFIG PATH, not the install root. The server's allowlist is keyed on the
    // config path it listed, so sending the root (`C:/cfg`) would 404 every time — and the two
    // differ here precisely so this cannot pass by coincidence.
    await waitFor(() => expect(api.mcpReveal).toHaveBeenCalledWith('C:/cfg/opencode.json'))
    // The note NAMES THE FOLDER instead of claiming a window opened: a headless host has no
    // opener and the server swallows that, so the path is the part the user can still act on.
    await waitFor(() => expect(screen.getByText(/Opening C:\/cfg/)).toBeTruthy())
  })

  it('nests MCP under an active CLAUDE install, joined by (host, root) not dirname', async () => {
    // A Claude global install: its config (~/.claude.json) sits OUTSIDE its root
    // (~/.claude), so the row only finds its servers via the (host, root) join.
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
          path: '/home/u/.claude.json', // dirname is /home/u — NOT the install root
          host: 'claude',
          root: '/home/u/.claude',
          exists: true,
          commented: false,
          servers: [
            // Claude is two-state: present = enabled, no 'disabled'.
            {
              name: 'markitdown',
              label: 'MarkItDown',
              desc: 'docs',
              preset: true,
              state: 'enabled',
            },
            { name: 'gitlab', label: 'GitLab', desc: 'mr', preset: true, state: 'absent' },
          ],
        },
      ],
      default: 0,
    })
    render(<Harness onAction={() => {}} themes={[{ name: 'neutral' }]} />)
    // The enabled Claude server shows nested; the absent preset offers Add.
    await waitFor(() => expect(screen.getByText('MarkItDown')).toBeTruthy())
    expect(screen.getByText('GitLab')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy()
  })

  it('draws no voice gallery until the overview lands', async () => {
    // The race `useOverview` makes possible: two effects, two setState calls, so the theme
    // list can arrive first. With no overview there is no deployed voice to pin and no emit
    // to build against, so the card must not paint at all — a gallery in that window offers
    // "Apply voice" on the voice you are already running.
    render(
      <Harness onAction={() => {}} themes={[{ name: 'neutral', tagline: 'plain', blurb: '' }]} />,
    )
    await waitFor(() => expect(screen.getByText('Every install')).toBeTruthy())
    // No overview means no deployed voice to mark — and a reference that marks nothing as
    // current, or marks the wrong row, is worse than one that appears a moment later.
    expect(document.querySelector('.voice-ref')).toBeNull()
  })

  it('renders the Excluded folders card when a global install exists', async () => {
    render(<Harness onAction={() => {}} />)
    await waitFor(() => expect(screen.getByText('Excluded folders')).toBeTruthy())
  })

  it('Switch: Enter toggles when enabled, does nothing when disabled', () => {
    // Native `disabled` already blocks click/Space/focus; the hand-rolled Enter path is
    // the one keydown handler that bypassed it (a second Enter before the busy re-render
    // landed could double-fire toggleInstall/toggleMcp) — this is the regression test.
    const onToggle = vi.fn()
    const { rerender } = render(
      <Switch on={false} disabled={false} label="activate x" onToggle={onToggle} />,
    )
    fireEvent.keyDown(screen.getByRole('switch'), { key: 'Enter' })
    expect(onToggle).toHaveBeenCalledTimes(1)

    rerender(<Switch on={false} disabled={true} label="activate x" onToggle={onToggle} />)
    fireEvent.keyDown(screen.getByRole('switch'), { key: 'Enter' })
    expect(onToggle).toHaveBeenCalledTimes(1) // unchanged — the disabled Enter did nothing
  })
})
