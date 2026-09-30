import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { usePoll } from '../hooks/usePoll.js'

// usePoll's contract, in ticks: one call on mount, one per interval while the tab is
// visible, none while hidden, one the moment the tab is fronted again, none after unmount.
const setHidden = (v) => Object.defineProperty(document, 'hidden', { value: v, configurable: true })

beforeEach(() => {
  vi.useFakeTimers()
  setHidden(false)
})
afterEach(() => {
  vi.useRealTimers()
  setHidden(false)
})

describe('usePoll', () => {
  it('polls on mount and on every visible interval', () => {
    const fn = vi.fn()
    renderHook(() => usePoll(fn, 1000, []))
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(3000)
    expect(fn).toHaveBeenCalledTimes(4)
  })

  it('skips ticks while hidden and catches up when fronted', () => {
    const fn = vi.fn()
    renderHook(() => usePoll(fn, 1000, []))
    setHidden(true)
    vi.advanceTimersByTime(5000)
    expect(fn).toHaveBeenCalledTimes(1)
    setHidden(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('stops on unmount, and alive() turns false for a late response', () => {
    const fn = vi.fn()
    const { unmount } = renderHook(() => usePoll(fn, 1000, []))
    const alive = fn.mock.calls[0][0]
    expect(alive()).toBe(true)
    unmount()
    expect(alive()).toBe(false)
    vi.advanceTimersByTime(5000)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('restarts when deps change, retiring the previous poll', () => {
    const fn = vi.fn()
    const { rerender } = renderHook(({ id }) => usePoll(() => fn(id), 1000, [id]), {
      initialProps: { id: 'a' },
    })
    rerender({ id: 'b' })
    vi.advanceTimersByTime(1000)
    expect(fn.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'b'])
  })
})
