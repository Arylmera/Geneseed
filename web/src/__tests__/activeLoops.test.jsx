import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../api/index.js', () => ({ api: { activeLoops: vi.fn(), setLoopPreset: vi.fn() } }))

import { ActiveDetail, useActiveLoops } from '../components/ActiveLoops.jsx'
import { api } from '../api/index.js'
import RingGraph from '../components/RingGraph.jsx'

// LP-10: a refused preset write must stay on screen until the user acts again — the 5 s poll
// that succeeds right after it used to wipe it — and the picker is locked while a write is out.
const LOOP = {
  root: 'C:/w/x',
  title: 'X',
  status: 'running',
  branch: 'b',
  preset: 'prudent',
  iteration: 1,
  node: 'a',
  history: [],
  graph: { name: 'g', nodes: ['a'], edges: [], loops: [] },
}
function Probe() {
  const runs = useActiveLoops()
  return (
    <>
      <p data-testid="err">{runs.error || ''}</p>
      <ActiveDetail loop={LOOP} bricks={[]} onPreset={runs.onPreset} />
    </>
  )
}
const flush = () => act(async () => {})

beforeEach(() => {
  vi.useFakeTimers()
  api.activeLoops.mockResolvedValue({ loops: [LOOP] })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('useActiveLoops preset writes', () => {
  it('keeps a failed write on screen through the next successful poll', async () => {
    api.setLoopPreset.mockRejectedValue(new Error('preset refused'))
    render(<Probe />)
    await flush()
    fireEvent.change(screen.getByLabelText('Preset for X'), { target: { value: 'aggressive' } })
    await flush()
    expect(screen.getByTestId('err').textContent).toBe('preset refused')
    await act(async () => vi.advanceTimersByTime(5000))
    expect(api.activeLoops).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('err').textContent).toBe('preset refused')
  })

  it('locks the picker while the write is out', async () => {
    let finish
    api.setLoopPreset.mockReturnValue(new Promise((r) => (finish = r)))
    render(<Probe />)
    await flush()
    const pick = screen.getByLabelText('Preset for X')
    fireEvent.change(pick, { target: { value: 'aggressive' } })
    expect(pick.disabled).toBe(true)
    await act(async () => finish({ ok: true }))
    expect(pick.disabled).toBe(false)
  })
})

// LP-1: an svg with role="img" makes its children presentational, so the node buttons would
// vanish for assistive tech while Tab still lands on them. LP-7: without `onSelect` (Active)
// a node does nothing, so it must be no button and no tab stop.
describe('RingGraph roles', () => {
  const graph = {
    name: 'g',
    nodes: ['a', 'b'],
    start: 'a',
    edges: [
      { from: 'a', on: 'pass', to: 'b' },
      { from: 'b', on: 'pass', to: '$close' },
    ],
    loops: [],
  }
  it('is a named group whose nodes are buttons when they can be picked', () => {
    const onSelect = vi.fn()
    const { container } = render(<RingGraph graph={graph} bricks={[]} onSelect={onSelect} />)
    expect(container.querySelector('svg').getAttribute('role')).toBe('group')
    expect(screen.getByRole('group', { name: 'g loop: a, b' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'a brick' }))
    expect(onSelect).toHaveBeenCalledWith('a')
  })
  it('has no buttons and no tab stops when nothing can be picked', () => {
    const { container } = render(<RingGraph graph={graph} bricks={[]} highlight="b" />)
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(container.querySelectorAll('[tabindex]').length).toBe(0)
    expect(screen.getByRole('img', { name: 'b brick, current step' })).toBeTruthy()
  })
})
