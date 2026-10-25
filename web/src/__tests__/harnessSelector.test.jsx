import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../api/index.js', () => ({ api: { selectView: vi.fn() } }))

import HarnessSelector from '../components/HarnessSelector.jsx'
import { api } from '../api/index.js'

// IN-16 / SH-25: a refused install switch must say so; it used to vanish in an empty catch.
const two = [
  { id: 'a', host: 'claude', scope: 'global', path: '/a', state: 'active', selected: true },
  { id: 'b', host: 'opencode', scope: 'global', path: '/b', state: 'active' },
]
afterEach(() => vi.clearAllMocks())

describe('HarnessSelector', () => {
  it('shows why a switch failed, and does not refetch', async () => {
    api.selectView.mockRejectedValue(new Error('install not found'))
    const onSwitch = vi.fn()
    render(<HarnessSelector installs={two} onSwitch={onSwitch} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b' } })
    expect((await screen.findByRole('alert')).textContent).toContain('install not found')
    expect(onSwitch).not.toHaveBeenCalled()
  })
})
