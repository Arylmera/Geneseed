import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// Settings is prop-driven now: ServerControl only touches the api on a click, so an
// empty stub keeps the import side-effect-free.
vi.mock('../api/index.js', () => ({ api: {} }))

import Settings from '../pages/Settings/index.jsx'

describe('Settings', () => {
  it('renders maintenance, the update button, and server control', () => {
    render(<Settings onAction={() => {}} />)
    // Per-install detail and build moved to the Harnesses tab + Dashboard; Settings keeps
    // machine maintenance (incl. the git-pull Update) and server control.
    expect(screen.getByText('Add to PATH')).toBeTruthy()
    expect(screen.getByText('Remove from PATH')).toBeTruthy()
    expect(screen.getByText('Update (git pull + rebuild)')).toBeTruthy()
    expect(screen.getByText('Stop server')).toBeTruthy()
  })

  // The Maintenance card once had an Uninstall that ran `geneseed uninstall --yes` with no
  // target, so it always removed the OpenCode global whatever install was viewed. Uninstall now
  // lives only on each install's own panel in Hosts, and the card says where.
  it('offers no uninstall in Maintenance and points to Hosts instead', () => {
    render(<Settings onAction={() => {}} />)
    const card = screen.getByRole('heading', { name: 'Maintenance' }).closest('.card')
    expect(within(card).queryByRole('button', { name: /uninstall/i })).toBeNull()
    expect(within(card).getByText(/Each install has its own Uninstall in/)).toBeTruthy()
    expect(within(card).getByRole('link', { name: 'Hosts' }).getAttribute('href')).toBe(
      '#/installs',
    )
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
