import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../api.js', () => ({
  api: {
    setup: () => Promise.resolve({
      deployed: true, target: 'C:/cfg', emit: 'opencode-global',
      theme: 'neutral', accent: 'cyan', version_verdict: 'up to date',
      installed_fp: 'abc1234', source_fp: 'abc1234', root: 'C:/geneseed',
      memory_dir: 'C:/cfg/memory', facts: 2, python: '3.12.1',
    }),
    themes: () => Promise.resolve({
      themes: [{ name: 'neutral', blurb: '' }, { name: 'imperial', blurb: '' }],
      emits: [{ name: 'opencode-global', desc: '' }],
      current: { theme: 'neutral', emit: 'opencode-global' },
    }),
    mcp: vi.fn(() => Promise.resolve({
      targets: [{
        label: 'global config', path: 'C:/cfg/opencode.json', exists: true,
        commented: false,
        servers: [{ name: 'markitdown', label: 'MarkItDown', desc: 'docs', preset: true, state: 'enabled' }],
      }],
      default: 0,
    })),
  },
}))

import Settings from '../pages/Settings.jsx'
import { api } from '../api.js'

describe('Settings', () => {
  it('renders the install snapshot and the build picker', async () => {
    render(<Settings onAction={() => {}} />)
    await waitFor(() => expect(screen.getByText('up to date')).toBeTruthy())
    expect(screen.getAllByText(/opencode-global/).length).toBeGreaterThan(0)
    expect(screen.getByText('C:/geneseed')).toBeTruthy()   // source root
    expect(screen.getByText('Build')).toBeTruthy()
    expect(screen.getByText('Update')).toBeTruthy()
  })

  it('renders switch toggles for present servers', async () => {
    render(<Settings onAction={() => {}} />)
    // Wait for MCP data to load
    await waitFor(() => expect(screen.getAllByRole('switch').length).toBeGreaterThan(0))
    // enabled server renders as a switch
    const switches = screen.getAllByRole('switch')
    expect(switches.length).toBeGreaterThanOrEqual(1)
    // the enabled server's switch has aria-checked=true
    expect(switches[0].getAttribute('aria-checked')).toBe('true')
  })

  it('renders Add button for absent preset servers', async () => {
    // Override mcp for this test: one absent preset server + one absent non-preset server
    vi.mocked(api.mcp).mockResolvedValueOnce({
      targets: [{
        label: 'global config', path: 'C:/cfg/opencode.json', exists: true,
        commented: false,
        servers: [
          { name: 'context7', label: 'Context7', desc: 'docs', preset: true, state: 'absent' },
          { name: 'custom-srv', label: 'Custom', desc: 'custom', preset: false, state: 'absent' },
        ],
      }],
      default: 0,
    })

    render(<Settings onAction={() => {}} />)

    // Absent preset server renders an Add button
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy())

    // Absent non-preset server renders no switch and no Add button (only one Add total)
    const addButtons = screen.getAllByRole('button', { name: 'Add' })
    expect(addButtons.length).toBe(1)

    // No switch for either absent server
    const switches = screen.queryAllByRole('switch')
    expect(switches.length).toBe(0)
  })
})
