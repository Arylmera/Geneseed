import { act, render, renderHook } from '@testing-library/react'
import { createElement, useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sameOr, usePoll } from '../hooks/usePoll.js'

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

  // Every tick answers a NEW object. Equal to the last one, the state keeps its reference and the
  // page under it does not re-render: its mount and the first answer are its only two renders over
  // four quiet ticks (React may call the polling component itself once more before it bails out;
  // the subtree is what costs). A changed answer renders once more.
  it('re-renders the page for a changed answer only, written through sameOr', () => {
    let answer = { runs: [{ id: 'a' }] }
    let renders = 0
    const Page = ({ data }) => {
      renders++
      return data ? data.runs.length : null
    }
    const Poller = () => {
      const [data, setData] = useState(null)
      usePoll(() => setData(sameOr(structuredClone(answer))), 1000, [])
      return createElement(Page, { data })
    }
    render(createElement(Poller))
    expect(renders).toBe(2)
    // One stringify per answer: the one on screen keeps its string, it is not stringified again.
    const stringify = vi.spyOn(JSON, 'stringify')
    act(() => vi.advanceTimersByTime(4000))
    expect(stringify).toHaveBeenCalledTimes(4)
    stringify.mockRestore()
    expect(renders).toBe(2)
    answer = { runs: [{ id: 'a' }, { id: 'b' }] }
    act(() => vi.advanceTimersByTime(1000))
    expect(renders).toBe(3)
  })
})
