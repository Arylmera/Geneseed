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
    const select = await screen.findByLabelText('voice for the new install')
    fireEvent.change(select, { target: { value: 'neutral' } })
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(onAction).toHaveBeenCalledWith('install', expect.objectContaining({ theme: 'neutral' }))
  })

  it('renders switch toggles for the active install and present MCP servers', async () => {
    render(<Harnesses onAction={() => {}} />)
    await waitFor(() => expect(screen.getAllByRole('switch').length).toBeGreaterThan(0))
    const switches = screen.getAllByRole('switch')
    // at least one is "on" (the active install and the enabled MCP server)
    expect(switches.some((s) => s.getAttribute('aria-checked') === 'true')).toBe(true)
  })

  it('renders an Add button for absent preset MCP servers (OpenCode-scoped)', async () => {
    vi.mocked(api.mcp).mockResolvedValueOnce({
      targets: [
        {
          label: 'global config',
          path: 'C:/cfg/opencode.json',
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
    // No active install either, so no install switch — only MCP's Add button is in play.
    vi.mocked(api.installs).mockResolvedValueOnce({
      installs: [
        {
          id: 'opencode:global',
          host: 'opencode',
          scope: 'global',
          path: 'C:/cfg',
          state: 'absent',
        },
      ],
    })
    render(<Harnesses onAction={() => {}} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy())
    expect(screen.getAllByRole('button', { name: 'Add' }).length).toBe(1)
    expect(screen.queryAllByRole('switch').length).toBe(0)
  })
})
