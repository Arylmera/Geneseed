import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../api/index.js', () => ({
  api: {
    setup: () =>
      Promise.resolve({
        deployed: true,
        target: 'C:/cfg',
        emit: 'opencode-global',
        theme: 'neutral',
        accent: 'cyan',
        version_verdict: 'up to date',
        installed_fp: 'abc1234',
        source_fp: 'abc1234',
        root: 'C:/geneseed',
        memory_dir: 'C:/cfg/memory',
        facts: 2,
        python: '3.12.1',
      }),
    themes: () =>
      Promise.resolve({
        themes: [
          { name: 'neutral', blurb: '' },
          { name: 'imperial', blurb: '' },
        ],
        emits: [{ name: 'opencode-global', desc: '' }],
        current: { theme: 'neutral', emit: 'opencode-global' },
      }),
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
    installs: vi.fn(() =>
      Promise.resolve({
        installs: [
          {
            id: 'opencode:global config',
            host: 'opencode',
            scope: 'global config',
            path: 'C:/cfg',
            state: 'active',
          },
        ],
      }),
    ),
    installToggle: vi.fn(() => Promise.resolve({ ok: true })),
  },
}))

import Settings from '../pages/Settings/index.jsx'

describe('Settings', () => {
  it('renders the install snapshot and the build picker', async () => {
    render(<Settings onAction={() => {}} />)
    await waitFor(() => expect(screen.getByText('up to date')).toBeTruthy())
    expect(screen.getAllByText(/opencode-global/).length).toBeGreaterThan(0)
    expect(screen.getByText('C:/geneseed')).toBeTruthy() // source root
    expect(screen.getByText('Build')).toBeTruthy()
    expect(screen.getByText('Update')).toBeTruthy()
  })
})
