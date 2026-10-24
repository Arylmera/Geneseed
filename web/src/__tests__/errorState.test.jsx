import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ErrorState from '../components/ErrorState.jsx'

// The old contract (`{ error, style }`, nothing without an error, the `.badge.bad` look) is
// kept for its ~18 callers; what is new is the alert role and the optional Retry.
describe('ErrorState', () => {
  it('renders nothing without an error', () => {
    const { container } = render(<ErrorState error={null} />)
    expect(container.innerHTML).toBe('')
  })

  it('is an alert carrying the message, in the old badge look, with the caller style', () => {
    render(<ErrorState error="daemon gone" style={{ margin: 18 }} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('daemon gone')
    expect(alert.className).toBe('badge bad')
    expect(alert.style.margin).toBe('18px')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('offers Retry when given onRetry, and Retry calls it', () => {
    const onRetry = vi.fn()
    render(<ErrorState error="daemon gone" onRetry={onRetry} />)
    expect(screen.getByRole('alert').textContent).toContain('daemon gone')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('role={null} drops the alert, for a caller that is the alert itself', () => {
    render(<ErrorState error="boom" role={null} />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('boom').className).toBe('badge bad')
  })
})
