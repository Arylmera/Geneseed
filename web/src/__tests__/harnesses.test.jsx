import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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
  },
}))

import Harnesses from '../pages/Harnesses.jsx'
import { api } from '../api/index.js'

describe('Harnesses', () => {
  it('lists each install (host · scope) and a Rebuild all button', async () => {
    render(<Harnesses onAction={() => {}} />)
    await waitFor(() => expect(screen.getAllByText(/global/).length).toBeGreaterThan(0))
    // both the active OpenCode and the absent Claude rows render
    expect(screen.getAllByText(/opencode/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/claude/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /rebuild all/i })).toBeTruthy()
  })

  it('Rebuild all dispatches the build-all action', async () => {
    const onAction = vi.fn()
    render(<Harnesses onAction={onAction} />)
    const btn = await screen.findByRole('button', { name: /rebuild all/i })
    fireEvent.click(btn)
    expect(onAction).toHaveBeenCalledWith('build-all')
  })

  it('offers Install on an absent row and dispatches install with the chosen voice', async () => {
    const onAction = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    // The voice picker defaults to the current deployed voice.
    render(
      <Harnesses
        onAction={onAction}
        currentTheme="imperial"
        themes={[{ name: 'neutral' }, { name: 'imperial' }]}
      />,
    )
    // The mock's claude:global row is absent -> exactly one Install button.
    const btn = await screen.findByRole('button', { name: 'Install' })
    fireEvent.click(btn)
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

  it('the voice picker changes the install theme', async () => {
    const onAction = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <Harnesses
        onAction={onAction}
        currentTheme="imperial"
        themes={[{ name: 'neutral' }, { name: 'imperial' }]}
      />,
    )
    const select = await screen.findByLabelText('voice for claude · global')
    fireEvent.change(select, { target: { value: 'neutral' } })
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(onAction).toHaveBeenCalledWith('install', expect.objectContaining({ theme: 'neutral' }))
  })

  it('re-themes an active install via the voice picker (the Apply button)', async () => {
    const onAction = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
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
    render(<Harnesses onAction={onAction} themes={[{ name: 'neutral' }, { name: 'imperial' }]} />)
    const select = await screen.findByLabelText('voice for opencode · global')
    fireEvent.change(select, { target: { value: 'imperial' } }) // Apply enables once the voice differs
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onAction).toHaveBeenCalledWith(
      'install',
      expect.objectContaining({ host: 'opencode', theme: 'imperial' }),
    )
  })

  it('renders switch toggles for the active install and its nested MCP servers', async () => {
    render(<Harnesses onAction={() => {}} />)
    // The active OpenCode row carries its own install switch, on by default.
    await waitFor(() => expect(screen.getAllByRole('switch').length).toBeGreaterThan(0))
    const switches = screen.getAllByRole('switch')
    expect(switches.some((s) => s.getAttribute('aria-checked') === 'true')).toBe(true)
    // Its MCP servers (under C:/cfg/opencode.json) are nested in the row, shown by default.
    expect(screen.getByText('MarkItDown')).toBeTruthy()
  })

  it('collapses and re-expands an active row’s MCP wiring via the chevron', async () => {
    render(<Harnesses onAction={() => {}} />)
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
    render(<Harnesses onAction={() => {}} themes={[{ name: 'neutral' }]} />)
    // Absent preset → Add button; absent non-preset → nothing. One Add in total.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy())
    expect(screen.getAllByRole('button', { name: 'Add' }).length).toBe(1)
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
    render(<Harnesses onAction={() => {}} themes={[{ name: 'neutral' }]} />)
    // The enabled Claude server shows nested; the absent preset offers Add.
    await waitFor(() => expect(screen.getByText('MarkItDown')).toBeTruthy())
    expect(screen.getByText('GitLab')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy()
  })
})
