import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

const jobs = vi.fn()
const job = vi.fn()
const action = vi.fn()
vi.mock('../api/index.js', () => ({
  api: { jobs: (...a) => jobs(...a), job: (...a) => job(...a), action: (...a) => action(...a) },
}))
vi.mock('../hooks/waitForServer.js', () => ({
  serverPid: () => Promise.resolve(1),
  waitForServerThenReload: vi.fn(),
}))

import { useJobs } from '../hooks/useJobs.js'
import { waitForServerThenReload } from '../hooks/waitForServer.js'

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

  // A rebuild on a stale server ends with that server restarting itself (it answers
  // `restarts: true`), so the page must wait for the new one and reload, as after an update —
  // a soft refresh would keep the old console on screen.
  it('reloads after a job the server said it restarts after', async () => {
    vi.useFakeTimers()
    jobs.mockResolvedValueOnce({ jobs: [] })
    action.mockResolvedValueOnce({ job_id: 'j2', restarts: true })
    job.mockResolvedValueOnce({ id: 'j2', status: 'done', output: 'ok', duration: 1 })
    const onFinish = vi.fn()
    const { result } = renderHook(() => useJobs({ onFinish }))
    await act(async () => {})
    await act(() => result.current.runAction('build-all'))
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(waitForServerThenReload).toHaveBeenCalled()
    expect(onFinish).not.toHaveBeenCalled()
  })

  // The server restarts only when the job succeeded; after a failure no new server comes, so
  // the page refreshes softly at once instead of waiting out the restart budget.
  it('soft-refreshes, not reloads, when a restarting job fails', async () => {
    vi.useFakeTimers()
    waitForServerThenReload.mockClear()
    jobs.mockResolvedValueOnce({ jobs: [] })
    action.mockResolvedValueOnce({ job_id: 'j3', restarts: true })
    job.mockResolvedValueOnce({ id: 'j3', status: 'failed', output: 'boom', duration: 1 })
    const onFinish = vi.fn()
    const { result } = renderHook(() => useJobs({ onFinish }))
    await act(async () => {})
    await act(() => result.current.runAction('build-all'))
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(waitForServerThenReload).not.toHaveBeenCalled()
    expect(onFinish).toHaveBeenCalledWith('failed')
  })
})
