import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import BootSplash from '../components/BootSplash.jsx'

// SH-30: the splash waits on the first overview fetch, which has no timeout. A server that
// never answers must not leave a full-screen, aria-hidden splash up forever: after 8 s it
// says so and offers Retry (a page reload).
const reload = vi.fn()
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  reload.mockReset()
})

describe('BootSplash', () => {
  it('offers Retry once the server has been silent for 8 s', () => {
    render(<BootSplash ready={false} />)
    act(() => vi.advanceTimersByTime(7900))
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByRole('alert').textContent).toContain('not answering')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('never shows Retry when the overview lands in time', () => {
    const onDone = vi.fn()
    const { rerender } = render(<BootSplash ready={false} onDone={onDone} />)
    act(() => vi.advanceTimersByTime(600))
    rerender(<BootSplash ready onDone={onDone} />)
    act(() => vi.advanceTimersByTime(9000))
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(onDone).toHaveBeenCalled()
  })
})
