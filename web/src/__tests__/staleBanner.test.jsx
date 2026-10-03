import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

const restart = vi.fn(() => Promise.resolve())
vi.mock('../api/index.js', () => ({ api: { restart: (...a) => restart(...a) } }))
const reload = vi.fn()
vi.mock('../hooks/waitForServer.js', () => ({
  RESTART_POLL_INTERVAL_MS: 1000,
  waitForServerThenReload: (...a) => reload(...a),
}))

import Dashboard from '../pages/Dashboard/index.jsx'

const overview = {
  deployed: true,
  theme: 'neutral',
  emit: 'opencode-global',
  target: '/home/u/.config/opencode',
  build_time: '2026-06-12 09:41',
  doctor: { ok: true, problems: [], checked_at: '2026-06-12' },
  diff: { edited: 0, added: 0, missing: 0 },
  counts: { agents: 1, skills: 1, laws: 9, memory: 0, notebook: 0, wiki: 0, config: 0 },
}
const themes = [{ name: 'neutral', accent: 'green', tagline: '', sigil: '', blurb: '' }]
const TEXT = 'This console is running code from before your last upgrade.'

const show = (stale) =>
  render(
    <Dashboard
      overview={{ ...overview, daemon_stale: stale }}
      themes={themes}
      setup={null}
      runs={[]}
      onAction={() => {}}
    />,
  )

describe('the stale-console banner', () => {
  it('shows when the server runs pre-upgrade code, and Restart restarts it', async () => {
    show(true)
    expect(screen.getByText(TEXT)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(reload).toHaveBeenCalledWith(1000))
  })

  it('is absent when the server is current', () => {
    show(false)
    expect(screen.queryByText(TEXT)).toBeNull()
  })
})
