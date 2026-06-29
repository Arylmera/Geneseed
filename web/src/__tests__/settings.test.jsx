import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// Settings is prop-driven now: ServerControl only touches the api on a click, so an
// empty stub keeps the import side-effect-free.
vi.mock('../api/index.js', () => ({ api: {} }))

import Settings from '../pages/Settings/index.jsx'

describe('Settings', () => {
  it('renders maintenance, the offline package, and server control', () => {
    render(<Settings onAction={() => {}} />)
    // Per-install detail and build/update moved to the Harnesses tab + Dashboard;
    // Settings keeps machine maintenance, the offline package, and server control.
    expect(screen.getByText('Add to PATH')).toBeTruthy()
    expect(screen.getByText('Remove from PATH')).toBeTruthy()
    expect(screen.getByText('Uninstall')).toBeTruthy()
    expect(screen.getByText('Download offline package')).toBeTruthy()
    expect(screen.getByText('Stop server')).toBeTruthy()
  })

  it('shows the footprint dial for the current install', () => {
    render(
      <Settings
        onAction={() => {}}
        overview={{ install: { host: 'opencode', scope: 'global' }, footprint: 'full' }}
      />,
    )
    expect(screen.getByText('Harness footprint')).toBeTruthy()
  })
})
