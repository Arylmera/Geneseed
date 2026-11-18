import React from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/index.js', () => ({
  api: { activeLoops: vi.fn(), activeFactories: vi.fn(), setLoopPreset: vi.fn() },
}))

import { api } from '../api/index.js'
import { ViewLevelProvider } from '../hooks/useViewLevel.jsx'
import HiddenLive from '../components/HiddenLive.jsx'

const KEY = 'geneseed-view-level'
const flush = () => act(async () => {})
const at = (level) => {
  localStorage.setItem(KEY, level)
  render(
    <ViewLevelProvider>
      <HiddenLive />
    </ViewLevelProvider>,
  )
}

describe('HiddenLive', () => {
  beforeEach(() => {
    localStorage.clear()
    api.activeLoops.mockResolvedValue({ loops: [] })
    api.activeFactories.mockResolvedValue({ factories: [] })
  })
  afterEach(() => vi.clearAllMocks())

  it('names running loops the level hides, linking to them', async () => {
    api.activeLoops.mockResolvedValue({
      loops: [{ status: 'running' }, { status: 'awaiting' }, { status: 'done' }],
    })
    at('essentials')
    await flush()
    const a = screen.getByText('2 loops running · Power').closest('a')
    expect(a.getAttribute('href')).toBe('#/loops/active')
  })

  it('names live factory runs, singular, with ended runs left out', async () => {
    api.activeFactories.mockResolvedValue({
      factories: [{ status: 'awaiting' }, { status: 'stopped' }, { status: 'done' }],
    })
    at('standard')
    await flush()
    const a = screen.getByText('1 factory run running · Power').closest('a')
    expect(a.getAttribute('href')).toBe('#/factories/active')
  })

  it('names both kinds when both are live', async () => {
    api.activeLoops.mockResolvedValue({ loops: [{ status: 'running' }] })
    api.activeFactories.mockResolvedValue({ factories: [{ status: 'running' }] })
    at('essentials')
    await flush()
    expect(screen.getByText('1 loop running · Power')).toBeTruthy()
    expect(screen.getByText('1 factory run running · Power')).toBeTruthy()
  })

  it('says nothing when nothing is live', async () => {
    api.activeLoops.mockResolvedValue({ loops: [{ status: 'stopped' }] })
    at('essentials')
    await flush()
    expect(screen.queryByText(/running/)).toBeNull()
  })

  it('says nothing and polls nothing at Power', async () => {
    at('power')
    await flush()
    expect(screen.queryByText(/running/)).toBeNull()
    expect(api.activeLoops).not.toHaveBeenCalled()
    expect(api.activeFactories).not.toHaveBeenCalled()
  })
})
