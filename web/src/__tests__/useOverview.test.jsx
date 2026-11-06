import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOverview } from '../hooks/useOverview.js'
import { api } from '../api/index.js'

vi.mock('../api/index.js', () => ({ api: { overview: vi.fn(), themes: vi.fn() } }))

// A cold daemon answers `doctor: null` while its warm-up runs: the hook asks again until the
// verdict lands, says so once, then stops asking.
describe('useOverview and a pending doctor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    api.themes.mockResolvedValue({ themes: [] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  const tick = (ms) => act(() => vi.advanceTimersByTimeAsync(ms))

  it('polls until the verdict lands, then fires onVerdict once and stops', async () => {
    api.overview
      .mockResolvedValueOnce({ doctor: null })
      .mockResolvedValueOnce({ doctor: null })
      .mockResolvedValue({ doctor: { ok: true, problems: [] } })
    const onVerdict = vi.fn()
    const { result } = renderHook(() => useOverview(undefined, onVerdict))
    await tick(0)
    expect(result.current.overview.doctor).toBe(null)
    expect(onVerdict).not.toHaveBeenCalled()
    await tick(1500)
    expect(api.overview).toHaveBeenCalledTimes(2)
    await tick(1500)
    expect(result.current.overview.doctor.ok).toBe(true)
    expect(onVerdict).toHaveBeenCalledTimes(1)
    await tick(6000)
    expect(api.overview).toHaveBeenCalledTimes(3)
    expect(onVerdict).toHaveBeenCalledTimes(1)
  })

  it('a failed poll asks again, without a toast per try', async () => {
    api.overview
      .mockResolvedValueOnce({ doctor: null })
      .mockRejectedValueOnce(new Error('gone'))
      .mockRejectedValueOnce(new Error('gone'))
      .mockResolvedValue({ doctor: { ok: true, problems: [] } })
    const onError = vi.fn()
    const onVerdict = vi.fn()
    const { result } = renderHook(() => useOverview(onError, onVerdict))
    await tick(0)
    await tick(1500)
    await tick(1500)
    await tick(1500)
    expect(result.current.overview.doctor.ok).toBe(true)
    expect(onVerdict).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('a verdict on the first answer asks nothing more', async () => {
    api.overview.mockResolvedValue({ doctor: { ok: false, problems: ['x'] } })
    const onVerdict = vi.fn()
    renderHook(() => useOverview(undefined, onVerdict))
    await tick(6000)
    expect(api.overview).toHaveBeenCalledTimes(1)
    expect(onVerdict).not.toHaveBeenCalled()
  })
})
