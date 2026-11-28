import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOverview } from '../hooks/useOverview.js'
import { api } from '../api/index.js'

vi.mock('../api/index.js', () => ({ api: { overview: vi.fn(), themes: vi.fn() } }))

// The warm-up asks back off (1500, 2250, 3375 ms, then 4000 ms each) and are bounded: a poll is
// only scheduled while the time already waited plus its delay stays within 60 000 ms. That is 16
// polls (the last at 59 125 ms) after the first ask: 17 asks in all. A fresh object per answer, as
// real JSON gives: the same object would not re-render. Then the hook says so
// (`warmup: 'slow'`) and `recheck` starts a fresh round.
describe('useOverview warm-up backoff and bound', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    api.themes.mockResolvedValue({ themes: [] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })
  const tick = (ms) => act(() => vi.advanceTimersByTimeAsync(ms))
  // Each answer re-renders, and only then is the next ask scheduled: so wait out a span in steps
  // of 500 ms, letting React settle between them (one big jump would outrun the renders).
  const wait = async (ms) => {
    for (let t = 0; t < ms; t += 500) await tick(500)
  }

  it('backs off: 1500, 2250, 3375, then 4000 ms between asks', async () => {
    api.overview.mockImplementation(async () => ({ doctor: null }))
    const { result } = renderHook(() => useOverview())
    await tick(0)
    expect(api.overview).toHaveBeenCalledTimes(1)
    expect(result.current.warmup).toBe('pending')
    await tick(1499)
    expect(api.overview).toHaveBeenCalledTimes(1)
    await tick(1)
    expect(api.overview).toHaveBeenCalledTimes(2)
    await tick(2249)
    expect(api.overview).toHaveBeenCalledTimes(2)
    await tick(1)
    expect(api.overview).toHaveBeenCalledTimes(3)
    await tick(3374)
    expect(api.overview).toHaveBeenCalledTimes(3)
    await tick(1)
    expect(api.overview).toHaveBeenCalledTimes(4)
    await tick(3999)
    expect(api.overview).toHaveBeenCalledTimes(4)
    await tick(1)
    expect(api.overview).toHaveBeenCalledTimes(5)
  })

  it('stops after 60 s: 17 asks, then warmup is "slow" and nothing more is asked', async () => {
    api.overview.mockImplementation(async () => ({ doctor: null }))
    const { result } = renderHook(() => useOverview())
    await tick(0)
    await wait(60000)
    expect(api.overview).toHaveBeenCalledTimes(17)
    expect(result.current.warmup).toBe('slow')
    await wait(600000)
    expect(api.overview).toHaveBeenCalledTimes(17)
    expect(result.current.warmup).toBe('slow')
  })

  it('warmup is null once the verdict lands', async () => {
    api.overview
      .mockResolvedValueOnce({ doctor: null })
      .mockResolvedValue({ doctor: { ok: true, problems: [] } })
    const { result } = renderHook(() => useOverview())
    await tick(0)
    expect(result.current.warmup).toBe('pending')
    await tick(1500)
    expect(result.current.warmup).toBe(null)
  })

  it('recheck after giving up asks at once and starts a fresh round', async () => {
    api.overview.mockImplementation(async () => ({ doctor: null }))
    const { result } = renderHook(() => useOverview())
    await tick(0)
    await wait(60000)
    expect(result.current.warmup).toBe('slow')
    await act(async () => result.current.recheck())
    expect(api.overview).toHaveBeenCalledTimes(18)
    expect(result.current.warmup).toBe('pending')
    await tick(1500)
    expect(api.overview).toHaveBeenCalledTimes(19)
  })
})
