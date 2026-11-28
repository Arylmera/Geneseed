import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, it, expect, vi } from 'vitest'

// While the daemon's doctor is still warming up the Overview says so in plain words: a polite
// status line, gone once the verdict lands. After the hook gives up it says the check is slow and
// offers one button to try again, so the wait is never a dead end.

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
    doctor: vi.fn(),
    recent: vi.fn(),
    themes: vi.fn(),
    docs: vi.fn(),
    installs: vi.fn(),
  },
}))

import Overview from '../pages/Overview/index.jsx'
import { api } from '../api/index.js'
import { clearAsyncCache } from '../hooks/useAsync.js'

const overview = {
  deployed: true,
  doctor: null,
  theme: 'imperial',
  emit: 'claude-global',
  target: '/home/u/.claude',
  footprint: 'lean',
  build_time: '2026-10-20 09:41',
  diff: { edited: 0, added: 0, missing: 0 },
  counts: { agents: 3, skills: 5, laws: 9, memory: 0, notebook: 0, wiki: 0, config: 0 },
}

beforeEach(() => {
  vi.clearAllMocks()
  clearAsyncCache()
  localStorage.clear()
  for (const k of ['usage', 'gates', 'rules', 'activity', 'profile', 'recent', 'themes', 'docs']) {
    api[k].mockImplementation(() => Promise.resolve(null))
  }
  api.catalog.mockResolvedValue({ items: [] })
  api.installs.mockResolvedValue({
    installs: [{ id: 'c', host: 'claude', scope: 'global', path: '/h/.claude', state: 'active' }],
  })
  api.fleet.mockResolvedValue({ installs: [] })
  api.update.mockResolvedValue({ current: '1.0.0', latest: '1.0.0', available: false })
  api.doctor.mockResolvedValue({ groups: [] })
})

const show = (props) => render(<Overview overview={overview} onAction={vi.fn()} {...props} />)

describe('Overview while the doctor warms up', () => {
  it('pending: a polite status line says the installs are being checked', async () => {
    show({ warmup: 'pending' })
    const line = await screen.findByText('Checking your installs…')
    expect(line.closest('[role="status"]').getAttribute('aria-live')).toBe('polite')
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
  })

  it('no warm-up: no status line', async () => {
    show({ warmup: null })
    await screen.findAllByRole('button', { name: 'Run doctor' })
    expect(screen.queryByText('Checking your installs…')).toBeNull()
    expect(screen.queryByText('The check is taking longer than usual.')).toBeNull()
  })

  it('slow: says the check is taking long, and Check again calls onRecheck', async () => {
    const onRecheck = vi.fn()
    show({ warmup: 'slow', onRecheck })
    expect(await screen.findByText('The check is taking longer than usual.')).toBeTruthy()
    expect(screen.queryByText('Checking your installs…')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(onRecheck).toHaveBeenCalledTimes(1)
  })
})
