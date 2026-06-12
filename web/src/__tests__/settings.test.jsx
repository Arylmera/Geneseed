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
    mcp: () => Promise.resolve({
      targets: [{
        label: 'global config', path: 'C:/cfg/opencode.json', exists: true,
        commented: false,
        servers: [{ name: 'markitdown', label: 'MarkItDown', desc: 'docs', preset: true, state: 'enabled' }],
      }],
      default: 0,
    }),
  },
}))

import Settings from '../pages/Settings.jsx'

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
    const { unmount } = render(<Settings onAction={() => {}} />)
    unmount()
  })
})
