import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../api.js', () => ({
  api: {
    doctor: () => Promise.resolve({
      themes: ['neutral'], ok: false,
      problems: ['dead link x in AGENT.md'],
      groups: [
        { check: 'build', label: 'Build scan (neutral)', problems: ['dead link x in AGENT.md'] },
        { check: 'parity', label: 'Theme parity', problems: [] },
      ],
    }),
  },
}))

import Doctor from '../pages/Doctor.jsx'

describe('Doctor', () => {
  it('renders one card per check with status badges', async () => {
    render(<Doctor />)
    await waitFor(() => expect(screen.getByText('Build scan (neutral)')).toBeTruthy())
    expect(screen.getByText('Theme parity')).toBeTruthy()
    expect(screen.getByText('clean')).toBeTruthy()           // parity card
    expect(screen.getAllByText('1 problem').length).toBe(2)  // summary + build card
    expect(screen.getByText('dead link x in AGENT.md')).toBeTruthy() // expanded by default
  })
})
