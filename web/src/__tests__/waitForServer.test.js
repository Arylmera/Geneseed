import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const ping = vi.fn()
const restart = vi.fn()
vi.mock('../api/index.js', () => ({
  api: { ping: (...a) => ping(...a), restart: (...a) => restart(...a) },
}))

import { restartAndReload } from '../hooks/waitForServer.js'

let reload
beforeEach(() => {
  vi.useFakeTimers()
  ping.mockReset()
  restart.mockReset()
  reload = vi.fn()
  vi.stubGlobal('location', { reload })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('restartAndReload', () => {
  // The OLD server keeps answering /api/ping for a moment after /api/restart returns. Reloading
  // on the first answer landed the page on the old server and its old CSRF token. The rule: wait
  // for a pid other than the one asked to restart.
  it('reloads only once a server with a NEW pid answers', async () => {
    ping
      .mockResolvedValueOnce({ ok: true, pid: 100 }) // before the restart
      .mockResolvedValueOnce({ ok: true, pid: 100 }) // the old server, still up
      .mockRejectedValueOnce(new TypeError('fetch failed')) // down
      .mockResolvedValueOnce({ ok: true, pid: 200 }) // the new one
    restart.mockResolvedValueOnce({ restarting: true })
    const done = restartAndReload()
    await vi.runAllTimersAsync()
    await done
    expect(ping).toHaveBeenCalledTimes(4)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('throws a refusal and does not reload', async () => {
    ping.mockResolvedValue({ ok: true, pid: 100 })
    restart.mockRejectedValueOnce(Object.assign(new Error('busy'), { status: 409 }))
    await expect(restartAndReload()).rejects.toThrow('busy')
    expect(reload).not.toHaveBeenCalled()
  })

  it('treats a dropped connection as the old server going down', async () => {
    ping.mockResolvedValueOnce({ ok: true, pid: 100 }).mockResolvedValueOnce({ ok: true, pid: 7 })
    restart.mockRejectedValueOnce(new TypeError('fetch failed'))
    const done = restartAndReload()
    await vi.runAllTimersAsync()
    await done
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
