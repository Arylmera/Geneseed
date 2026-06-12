import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../api.js', () => ({
  api: {
    doctor: () => Promise.resolve({
      themes: ['neutral', 'imperial'], ok: false,
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
  it('renders summary card with validated themes and overall badge', async () => {
    render(<Doctor />)
    // summary line: lowercase mono "validated N themes"
    await waitFor(() => expect(screen.getByText(/validated 2 themes/)).toBeTruthy())
    // a capitalized badge per theme
    expect(screen.getByText('Neutral')).toBeTruthy()
    expect(screen.getByText('Imperial')).toBeTruthy()
    // overall badge bad with N problem (prototype uses singular "problem")
    // both summary badge and check card badge show "1 problem" — assert at least one
    expect(screen.getAllByText(/1 problem/).length).toBeGreaterThanOrEqual(1)
  })

  it('renders one .card.check per group with h3 label and badge', async () => {
    render(<Doctor />)
    await waitFor(() => expect(screen.getByText('Build scan (neutral)')).toBeTruthy())
    expect(screen.getByText('Theme parity')).toBeTruthy()
    // clean card shows badge "clean"
    expect(screen.getByText('clean')).toBeTruthy()
    // dirty card shows "1 problem(s)" or "1 problems" — prototype uses "N problem(s)"
    expect(screen.getAllByText(/1 problem/).length).toBeGreaterThanOrEqual(1)
  })

  it('problem group is open by default and shows problem rows with ✕', async () => {
    render(<Doctor />)
    await waitFor(() => expect(screen.getByText('dead link x in AGENT.md')).toBeTruthy())
    expect(screen.getByText('✕')).toBeTruthy()
  })

  it('clicking a dirty check-head toggles the check-body', async () => {
    render(<Doctor />)
    await waitFor(() => expect(screen.getByText('Build scan (neutral)')).toBeTruthy())
    // body visible by default (open)
    expect(screen.getByText('dead link x in AGENT.md')).toBeTruthy()
    // click head to close
    fireEvent.click(screen.getByText('Build scan (neutral)').closest('.check-head'))
    expect(screen.queryByText('dead link x in AGENT.md')).toBeNull()
    // click head to re-open
    fireEvent.click(screen.getByText('Build scan (neutral)').closest('.check-head'))
    expect(screen.getByText('dead link x in AGENT.md')).toBeTruthy()
  })

  it('shows loading state while data is null, with correct button label', async () => {
    // The api promise never resolves during this test — we check the initial render
    let resolve
    const api = { doctor: () => new Promise((r) => { resolve = r }) }
    vi.doMock('../api.js', () => ({ api }))
    render(<Doctor />)
    // button disabled while loading, label "Running…"
    const btn = screen.getByRole('button')
    expect(btn.disabled).toBe(true)
    expect(btn.textContent).toMatch(/Running/)
    expect(screen.getByText(/Running every check/)).toBeTruthy()
  })
})
