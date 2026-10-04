import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

const jobs = vi.fn()
const job = vi.fn()
vi.mock('../api/index.js', () => ({
  api: { jobs: (...a) => jobs(...a), job: (...a) => job(...a) },
}))
vi.mock('../hooks/waitForServer.js', () => ({
  serverPid: () => Promise.resolve(1),
  waitForServerThenReload: vi.fn(),
}))

import { useJobs } from '../hooks/useJobs.js'

afterEach(() => vi.useRealTimers())

describe('useJobs', () => {
  // One failed poll of a NON-update job (a slow doctor holding the server's event loop) used to
  // stop the poller for good, leaving the run on 'running' forever. Only an update expects the
  // server to go away; every other job retries on the next tick.
  it('keeps polling a non-update job after a failed poll', async () => {
    vi.useFakeTimers()
    jobs.mockResolvedValueOnce({ jobs: [{ id: 'j1', action: 'doctor', status: 'running' }] })
    job
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({ id: 'j1', status: 'done', output: 'ok', duration: 1 })
    const onFinish = vi.fn()
    renderHook(() => useJobs({ onFinish }))
    await act(async () => {}) // the history hydrates; the poller starts on the running job
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(job).toHaveBeenCalledTimes(2)
    expect(onFinish).toHaveBeenCalledWith('done')
  })
})
