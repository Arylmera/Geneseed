import React from 'react'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../api/index.js', () => ({
  api: {
    doctor: vi.fn(() =>
      Promise.resolve({
        themes: ['neutral', 'imperial'],
        ok: false,
        problems: ['dead link x in AGENT.md'],
        groups: [
          { check: 'build', label: 'Build scan (neutral)', problems: ['dead link x in AGENT.md'] },
          { check: 'parity', label: 'Theme parity', problems: [] },
        ],
      }),
    ),
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

  // Mount serves the daemon's cached run; only the Re-run button may ask for a fresh one (it is
  // the ~3.6 s path), so the two calls must differ in exactly that argument.
  it('mounts on the cached verdict and re-runs fresh', async () => {
    api.doctor.mockClear()
    render(<Doctor />)
    await waitFor(() => expect(screen.getByText(/Re-run checks/)).toBeTruthy())
    expect(api.doctor).toHaveBeenCalledTimes(1)
    expect(api.doctor).toHaveBeenLastCalledWith(false, undefined)
    fireEvent.click(screen.getByText(/Re-run checks/))
    await waitFor(() => expect(api.doctor).toHaveBeenCalledTimes(2))
    expect(api.doctor).toHaveBeenLastCalledWith(true, undefined)
  })

  it('shows loading state while data is null, with correct button label', async () => {
    // Never-resolving promise — loading state persists even after microtask flush
    api.doctor.mockImplementationOnce(() => new Promise(() => {}))
    render(<Doctor />)
    // button disabled while loading, label "Running…" (once the install list has answered)
    const btn = await screen.findByRole('button')
    expect(btn.disabled).toBe(true)
    expect(btn.textContent).toMatch(/Running/)
    expect(screen.getByText(/Running every check/)).toBeTruthy()
    // Flush all pending microtasks — loading div must still be present (promise never resolved)
    await act(async () => {})
    expect(screen.getByText(/Running every check/)).toBeTruthy()
  })

  // The verdict says when it was taken: the HH:MM part of the payload's `checked_at`.
  it('shows when the checks last ran', async () => {
    api.doctor.mockResolvedValueOnce({
      themes: ['neutral'],
      ok: true,
      problems: [],
      checked_at: '2026-10-24 14:05',
      groups: [{ check: 'parity', label: 'Theme parity', problems: [] }],
    })
    render(<Doctor />)
    await waitFor(() => expect(screen.getByText(/checked 14:05/)).toBeTruthy())
  })

  // Problems lead; clean checks fold into one closed <details> that counts them.
  it('lists failing groups first and folds clean ones into a closed details', async () => {
    api.doctor.mockResolvedValueOnce({
      themes: ['neutral'],
      ok: false,
      problems: ['dead link x in AGENT.md'],
      groups: [
        { check: 'parity', label: 'Theme parity', problems: [] },
        { check: 'build', label: 'Build scan (neutral)', problems: ['dead link x in AGENT.md'] },
        { check: 'links', label: 'Link check', problems: [] },
      ],
    })
    render(<Doctor />)
    await waitFor(() => expect(screen.getByText('Build scan (neutral)')).toBeTruthy())
    const details = document.querySelector('details')
    expect(details).toBeTruthy()
    expect(details.open).toBe(false)
    expect(details.querySelector('summary').textContent).toMatch(/2 clean check/)
    expect(details.contains(screen.getByText('Theme parity'))).toBe(true)
    expect(details.contains(screen.getByText('Link check'))).toBe(true)
    const bad = screen.getByText('Build scan (neutral)')
    expect(details.contains(bad)).toBe(false)
    // The failing group sits before the folded clean ones in document order.
    expect(bad.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // A finished job bumps dataRev; the page re-reads the cached verdict, never a fresh run.
  it('re-reads the cached verdict when dataRev changes', async () => {
    const { rerender } = render(<Doctor dataRev={1} />)
    await waitFor(() => expect(screen.getByText(/Re-run checks/)).toBeTruthy())
    api.doctor.mockClear()
    rerender(<Doctor dataRev={2} />)
    await waitFor(() => expect(api.doctor).toHaveBeenCalledTimes(1))
    expect(api.doctor).toHaveBeenLastCalledWith(false, undefined)
  })

  // Re-run spends the fresh flag: the next dataRev read after it is the cached one again.
  it('reads cached after a fresh re-run when dataRev changes', async () => {
    const { rerender } = render(<Doctor dataRev={1} />)
    await waitFor(() => expect(screen.getByText(/Re-run checks/)).toBeTruthy())
    api.doctor.mockClear()
    fireEvent.click(screen.getByText(/Re-run checks/))
    await waitFor(() => expect(api.doctor).toHaveBeenLastCalledWith(true, undefined))
    await waitFor(() => expect(screen.getByText(/Re-run checks/)).toBeTruthy())
    rerender(<Doctor dataRev={2} />)
    await waitFor(() => expect(api.doctor).toHaveBeenCalledTimes(2))
    expect(api.doctor).toHaveBeenLastCalledWith(false, undefined)
  })

  // The tab checks ONE install, picked beside it (no console-wide one): the server's default row
  // first, then whatever the user picks, which is remembered for this tab alone. With two active
  // installs the picker shows; the inactive row is never offered.
  it('checks the default install, then the picked one, and remembers the pick', async () => {
    localStorage.clear()
    const oc = { id: 'oc', host: 'opencode', scope: 'global', path: '/oc', state: 'active' }
    const cl = {
      id: 'cl',
      host: 'claude',
      scope: 'global',
      path: '/cl',
      state: 'active',
      default: true,
    }
    const off = { id: 'bob', host: 'bob', scope: 'global', path: '/bob', state: 'disabled' }
    api.installs = vi.fn(async () => ({ installs: [oc, cl, off] }))
    try {
      api.doctor.mockClear()
      render(<Doctor />)
      const pick = await screen.findByRole('combobox', { name: 'Doctor for:' })
      expect([...pick.options].map((o) => o.textContent)).toEqual([
        'claude · global',
        'opencode · global',
      ])
      await waitFor(() =>
        expect(api.doctor).toHaveBeenLastCalledWith(false, { host: 'claude', path: '/cl' }),
      )
      fireEvent.change(pick, { target: { value: 'oc' } })
      await waitFor(() =>
        expect(api.doctor).toHaveBeenLastCalledWith(false, { host: 'opencode', path: '/oc' }),
      )
      expect(localStorage.getItem('geneseed-install-doctor')).toBe('oc')
    } finally {
      delete api.installs
      localStorage.clear()
    }
  })

  // One active install: nothing to pick, so no picker, and the page reads that install.
  it('shows no picker with one active install', async () => {
    const cl = {
      id: 'cl',
      host: 'claude',
      scope: 'global',
      path: '/cl',
      state: 'active',
      default: true,
    }
    api.installs = vi.fn(async () => ({ installs: [cl] }))
    try {
      api.doctor.mockClear()
      render(<Doctor />)
      await waitFor(() =>
        expect(api.doctor).toHaveBeenLastCalledWith(false, { host: 'claude', path: '/cl' }),
      )
      expect(screen.queryByRole('combobox')).toBeNull()
    } finally {
      delete api.installs
    }
  })

  it('holds exactly one filled button, Re-run checks, once loaded', async () => {
    const { container } = render(<Doctor />)
    await waitFor(() => expect(screen.getByText(/Re-run checks/)).toBeTruthy())
    const filled = container.querySelectorAll('.btn:not(.ghost)')
    expect(filled).toHaveLength(1)
    expect(filled[0].textContent).toMatch(/Re-run checks/)
  })
})
