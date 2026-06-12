import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import Dashboard from '../pages/Dashboard.jsx'

describe('Dashboard', () => {
  it('renders section counts from overview', () => {
    const overview = {
      theme: 'neutral', deployed: true, build_time: '2026-06-12 10:00',
      counts: { agents: 16, skills: 25, laws: 14, memory: 3, notebook: 1 },
      doctor: { ok: true, problems: [] },
      diff: { edited: 2, added: 1, missing: 0 },
    }
    render(<Dashboard overview={overview} onAction={() => {}} />)
    expect(screen.getByText('16')).toBeTruthy()   // agents count
    expect(screen.getByText('healthy')).toBeTruthy()
  })
})
