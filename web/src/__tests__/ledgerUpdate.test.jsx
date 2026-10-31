import React from 'react'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The Overview's version chip and its Update button. A git clone can always pull (main moves
// between releases, and a work proxy can leave the npm check unanswered), so it always gets
// Update. An npm install gets it only when a newer release is out.

vi.mock('../api/index.js', () => ({
  api: {
    fleet: vi.fn(),
    usage: vi.fn(),
    gates: vi.fn(),
    update: vi.fn(),
    rules: vi.fn(),
    activity: vi.fn(),
    profile: vi.fn(),
    catalog: vi.fn(),
  },
}))

import Ledger, { UPDATE_POLL_MS, UPDATE_RETRY_MS } from '../pages/Overview/Ledger.jsx'
import { api } from '../api/index.js'

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of ['fleet', 'usage', 'gates', 'rules', 'activity', 'profile', 'catalog']) {
    api[k].mockImplementation(() => Promise.resolve(null))
  }
})

const show = (update) => {
  api.update.mockResolvedValue(update)
  const onAction = vi.fn()
  render(<Ledger overview={null} onAction={onAction} />)
  return onAction
}

describe('Overview Update button', () => {
  it('shows on a git clone even when the release check is unavailable, and runs update', async () => {
    const onAction = show({ current: '4.15.0', latest: null, available: null, git: true })
    await screen.findByText(/update check unavailable/)
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    expect(onAction).toHaveBeenCalledWith('update')
  })

  it('shows on a git clone that is on the latest release', async () => {
    show({ current: '4.15.0', latest: '4.15.0', available: false, git: true })
    await screen.findByText(/latest/)
    expect(screen.getByRole('button', { name: 'Update' })).toBeTruthy()
  })

  it('is absent on an npm install with nothing newer', async () => {
    show({ current: '4.15.0', latest: '4.15.0', available: false, git: false })
    await screen.findByText(/latest/)
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull()
  })

  it('shows on an npm install when a newer release is out', async () => {
    show({ current: '4.15.0', latest: '4.16.0', available: true, git: false })
    await screen.findByText('4.16.0 available')
    expect(screen.getByRole('button', { name: 'Update' })).toBeTruthy()
  })
})

// The install kind and a clone's upstream count. A clone says how many commits it would pull
// (primary button) or that it is up to date (ghost button, still there); a global npm install
// names its npm route; a copy the console cannot update shows the command instead of a button,
// and only when there is something newer.
const base = { current: '4.16.0', latest: '4.16.0', available: false, checked_at: 1 }

describe('Overview Update button per install kind', () => {
  it('a clone behind upstream says how many commits to pull, with a primary button', async () => {
    show({ ...base, install: 'git', git: true, behind: 3, command: null })
    await screen.findByText('3 commits to pull')
    expect(screen.getByRole('button', { name: 'Update' }).className).toBe('btn')
  })

  it('a clone level with upstream says up to date, and keeps a ghost button', async () => {
    show({ ...base, install: 'git', git: true, behind: 0, command: null })
    await screen.findByText(/up to date/)
    const b = screen.getByRole('button', { name: 'Update' })
    expect(b.className).toBe('btn ghost')
    expect(b.title).toMatch(/^Nothing to pull/)
  })

  it('one commit is singular', async () => {
    show({ ...base, install: 'git', git: true, behind: 1, command: null })
    await screen.findByText('1 commit to pull')
  })

  it('a global npm install with a release out runs update through npm', async () => {
    const onAction = show({
      ...base,
      latest: '4.17.0',
      available: true,
      install: 'npm-global',
      git: false,
      behind: null,
      command: null,
    })
    await screen.findByText('4.17.0 available')
    const b = screen.getByRole('button', { name: 'Update' })
    expect(b.title).toBe('npm install -g geneseed@latest, then rebuild every install')
    fireEvent.click(b)
    expect(onAction).toHaveBeenCalledWith('update')
  })

  it('an other copy with a release out shows the command and no button', async () => {
    show({
      ...base,
      latest: '4.17.0',
      available: true,
      install: 'other',
      git: false,
      behind: null,
      command: 'npm install -g geneseed@latest',
    })
    await screen.findByText('npm install -g geneseed@latest')
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull()
  })

  it('an other copy with nothing newer shows neither', async () => {
    show({
      ...base,
      install: 'other',
      git: false,
      behind: null,
      command: 'npm install -g geneseed@latest',
    })
    await screen.findByText(/latest/)
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull()
    expect(screen.queryByText('npm install -g geneseed@latest')).toBeNull()
  })
})

// A page left open re-asks once an hour and whenever its tab comes back into view, so it learns
// within the hour what the daemon's once-a-day check found.
describe('Overview update re-check while the page is open', () => {
  afterEach(() => vi.useRealTimers())

  it('re-asks every UPDATE_POLL_MS and on visibility regain, and stops on unmount', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    api.update.mockResolvedValue({ ...base, install: 'git', git: true, behind: 0 })
    const { unmount } = render(<Ledger overview={null} onAction={vi.fn()} />)
    await screen.findByText(/up to date/)
    expect(api.update).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(UPDATE_POLL_MS - 1)
    expect(api.update).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(api.update).toHaveBeenCalledTimes(2)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(api.update).toHaveBeenCalledTimes(3)
    unmount()
    vi.advanceTimersByTime(UPDATE_POLL_MS)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(api.update).toHaveBeenCalledTimes(3)
  })

  it('a failed re-poll keeps the last answer instead of hiding the button', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    api.update.mockResolvedValueOnce({ ...base, install: 'git', git: true, behind: 2 })
    api.update.mockRejectedValue(new Error('daemon restarting'))
    render(<Ledger overview={null} onAction={vi.fn()} />)
    await screen.findByText('2 commits to pull')
    vi.advanceTimersByTime(UPDATE_POLL_MS)
    expect(api.update).toHaveBeenCalledTimes(2)
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByText('2 commits to pull')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Update' })).toBeTruthy()
  })
})

// A check the daemon has not answered yet (`checking: true`) is not a failed one: the chip says
// "checking…" and asks once more a few seconds on, instead of "unavailable" for up to the hour.
// A settled failure (`checking: false`) still reads "unavailable" and is not re-asked early.
describe('Overview update check still in flight', () => {
  afterEach(() => vi.useRealTimers())
  const flush = () => act(async () => {})

  it('reads "checking…", then re-asks once after UPDATE_RETRY_MS', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = { current: '4.15.0', latest: null, available: null, checked_at: null }
    api.update.mockResolvedValueOnce({ ...pending, checking: true, install: 'npm-global' })
    api.update.mockResolvedValue({
      current: '4.15.0',
      latest: '4.16.0',
      available: true,
      checked_at: 1,
      checking: false,
      install: 'npm-global',
    })
    render(<Ledger overview={null} onAction={vi.fn()} />)
    await flush()
    expect(screen.getByText(/4\.15\.0 · checking…/)).toBeTruthy()
    expect(screen.queryByText(/unavailable/)).toBeNull()
    expect(UPDATE_RETRY_MS).toBe(5000)
    vi.advanceTimersByTime(UPDATE_RETRY_MS)
    await flush()
    expect(api.update).toHaveBeenCalledTimes(2)
    expect(screen.getByText('4.16.0 available')).toBeTruthy()
  })

  it('a failed re-ask stops the early re-asks and reads "unavailable"', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    api.update.mockResolvedValueOnce({
      current: '4.15.0',
      latest: null,
      available: null,
      checked_at: null,
      checking: true,
      install: 'npm-global',
    })
    api.update.mockRejectedValue(new Error('daemon restarting'))
    render(<Ledger overview={null} onAction={vi.fn()} />)
    await flush()
    vi.advanceTimersByTime(UPDATE_RETRY_MS)
    await flush()
    expect(api.update).toHaveBeenCalledTimes(2)
    expect(screen.getByText(/update check unavailable/)).toBeTruthy()
    vi.advanceTimersByTime(UPDATE_RETRY_MS * 3)
    await flush()
    expect(api.update).toHaveBeenCalledTimes(2)
  })

  it('a settled failure stays "unavailable" and is not re-asked early', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    api.update.mockResolvedValue({
      current: '4.15.0',
      latest: null,
      available: null,
      checked_at: 1,
      checking: false,
      install: 'npm-global',
    })
    render(<Ledger overview={null} onAction={vi.fn()} />)
    await flush()
    expect(screen.getByText(/update check unavailable/)).toBeTruthy()
    vi.advanceTimersByTime(UPDATE_RETRY_MS)
    await flush()
    expect(api.update).toHaveBeenCalledTimes(1)
  })
})
