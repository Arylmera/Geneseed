import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Toast from '../components/Toast.jsx'

// SH-7: an error toast is the one a user most needs to read, so it waits for Dismiss; any
// other toast leaves after 3.5 s, but not while the pointer or focus is on it.
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const mount = (toast) => {
  const onClose = vi.fn()
  const view = render(<Toast toast={toast} onClose={onClose} />)
  return { onClose, ...view }
}

describe('Toast', () => {
  it('an error toast is still there after 10 s, and leaves on Dismiss', () => {
    const { onClose, container } = mount({ kind: 'err', msg: 'build failed' })
    // role="alert" is the error's one live semantics; the region goes quiet around it.
    expect(container.firstChild.hasAttribute('aria-live')).toBe(false)
    act(() => vi.advanceTimersByTime(10000))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('build failed')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a non-error toast dismisses itself at 3.5 s, not before', () => {
    const { onClose } = mount({ kind: 'info', msg: 'saved' })
    act(() => vi.advanceTimersByTime(3499))
    expect(onClose).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('hover pauses the dismiss; leaving starts a fresh 3.5 s', () => {
    const { onClose } = mount({ kind: 'info', msg: 'saved' })
    const box = screen.getByText('saved').closest('.toast')
    fireEvent.mouseEnter(box)
    act(() => vi.advanceTimersByTime(10000))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseLeave(box)
    act(() => vi.advanceTimersByTime(3499))
    expect(onClose).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('focus inside pauses the dismiss; blur out releases it and restarts 3.5 s', () => {
    const { onClose } = mount({ kind: 'ok', msg: 'done' })
    const btn = screen.getByRole('button', { name: 'Dismiss' })
    fireEvent.focus(btn)
    act(() => vi.advanceTimersByTime(10000))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.blur(btn, { relatedTarget: document.body })
    act(() => vi.advanceTimersByTime(3499))
    expect(onClose).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a hold belongs to one toast: dismissed under the pointer, the next one still leaves', () => {
    const onClose = vi.fn()
    const { rerender } = render(<Toast toast={{ kind: 'info', msg: 'first' }} onClose={onClose} />)
    fireEvent.mouseEnter(screen.getByText('first').closest('.toast'))
    // Dismiss unmounts the toast under the pointer: its mouseleave never fires.
    rerender(<Toast toast={null} onClose={onClose} />)
    rerender(<Toast toast={{ kind: 'info', msg: 'second' }} onClose={onClose} />)
    act(() => vi.advanceTimersByTime(3500))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('with no toast, renders only the empty live region, so it can stay mounted', () => {
    const { container, onClose } = mount(null)
    const region = container.firstChild
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.textContent).toBe('')
    expect(container.querySelector('.toast')).toBeNull()
    act(() => vi.advanceTimersByTime(10000))
    expect(onClose).not.toHaveBeenCalled()
  })
})
