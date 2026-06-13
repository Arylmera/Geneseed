import React from 'react'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../api/index.js', () => ({
  api: {
    doctor: vi.fn(() => Promise.resolve({
      themes: ['neutral', 'imperial'], ok: false,
      problems: ['dead link x in AGENT.md'],
      groups: [
        { check: 'build', label: 'Build scan (neutral)', problems: ['dead link x in AGENT.md'] },
        { check: 'parity', label: 'Theme parity', problems: [] },
      ],
    })),
  },
}))

import Doctor from '../pages/Doctor.jsx'
import { api } from '../api/index.js'

describe('Doctor', () => {
  it('renders summary card with validated themes and overall badge', async () => {
    render(<Doctor />)
    // summary line: lowercase mono "validated N themes"
    await waitFor(() => expect(screen.getByText(/validated 2 themes/)).toBeTruthy())
    // badge per theme — raw lowercase (CSS textTransform: capitalize handles display)
    expect(screen.getByText('neutral')).toBeTruthy()
    expect(screen.getByText('imperial')).toBeTruthy()
    // overall badge bad with N problem(s) — fixture has 1 so singular
    expect(screen.getAllByText(/1 problem/).length).toBeGreaterThanOrEqual(1)
  })

  it('renders one .card.check per group with h3 label and badge', async () => {
    render(<Doctor />)
    await waitFor(() => expect(screen.getByText('Build scan (neutral)')).toBeTruthy())
    expect(screen.getByText('Theme parity')).toBeTruthy()
    // clean card shows badge "clean"
    expect(screen.getByText('clean')).toBeTruthy()
    // dirty card shows "1 problem"
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
    // Never-resolving promise — loading state persists even after microtask flush
    api.doctor.mockImplementationOnce(() => new Promise(() => {}))
    render(<Doctor />)
    // button disabled while loading, label "Running…"
    const btn = screen.getByRole('button')
    expect(btn.disabled).toBe(true)
    expect(btn.textContent).toMatch(/Running/)
    expect(screen.getByText(/Running every check/)).toBeTruthy()
    // Flush all pending microtasks — loading div must still be present (promise never resolved)
    await act(async () => {})
    expect(screen.getByText(/Running every check/)).toBeTruthy()
  })
})
