import React from 'react'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import RunChips, { groupRuns } from '../pages/Dashboard/RunChips.jsx'

// The ages are relative to now, so the clock is pinned: an unpinned run read "61s ago".
const NOW = 1_700_000_000
beforeEach(() => vi.useFakeTimers({ now: NOW * 1000 }))
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const CMD = '$ C:\\Users\\u\\node.exe geneseed build --emit claude-global'
const job = (id, over = {}) => ({
  id,
  action: 'build',
  status: 'done',
  duration: 3,
  started: NOW - 60,
  output: `${CMD}\nok`,
  ...over,
})

describe('groupRuns', () => {
  it('folds adjacent runs with the same verb, scope and status into one group', () => {
    const groups = groupRuns([job('a'), job('b'), job('c')])
    expect(groups.length).toBe(1)
    expect(groups[0].id).toBe('a')
    expect(groups[0].jobs.map((j) => j.id)).toEqual(['a', 'b', 'c'])
  })

  it('never folds a failed run into a group of done runs', () => {
    const groups = groupRuns([job('a'), job('b', { status: 'failed' }), job('c')])
    expect(groups.map((g) => g.status)).toEqual(['done', 'failed', 'done'])
  })

  it('does not fold equal runs that are not adjacent', () => {
    const groups = groupRuns([job('a'), job('b', { action: 'doctor' }), job('c')])
    expect(groups.map((g) => g.verb)).toEqual(['build', 'doctor', 'build'])
  })
})

describe('RunChips', () => {
  it('shows ×3 for three folded runs', () => {
    const { container } = render(<RunChips jobs={[job('a'), job('b'), job('c')]} max={8} />)
    expect(container.querySelectorAll('.run-chip').length).toBe(1)
    expect(container.querySelector('.run-chip').textContent).toContain('×3')
  })

  it('gives a group its slowest duration and one bar per run, sized against the slowest', () => {
    // Oldest first, as the server sends it: j1 (5 s) is newest, so the group reads 5, 3. Two runs
    // split the column in half: 5 s (the slowest) takes 50%, 3 s takes 30%.
    const jobs = [
      job('j0', { duration: 3, started: NOW - 120 }),
      job('j1', { duration: 5, started: NOW - 60 }),
    ]
    const { container } = render(<RunChips jobs={jobs} max={8} />)
    const chip = container.querySelector('.run-chip')
    expect(chip.textContent).toContain('≤ 5 s')
    const bars = chip.querySelector('[role="img"]')
    expect(bars.getAttribute('aria-label')).toBe('Durations: 5, 3 seconds')
    expect([...bars.querySelectorAll('i')].map((i) => i.style.width)).toEqual(['50%', '30%'])
  })

  it('splits the bar column by the largest group, so equal durations draw equal bars', () => {
    // Newest first: a lone 4 s doctor, then two folded 4 s builds. The largest group holds two
    // runs, so each bar may take half the column: every 4 s bar is 50%, single or folded.
    const jobs = [
      job('b0', { duration: 4, started: NOW - 180 }),
      job('b1', { duration: 4, started: NOW - 120 }),
      job('d0', { action: 'doctor', duration: 4, started: NOW - 60 }),
    ]
    const { container } = render(<RunChips jobs={jobs} max={8} />)
    const widths = [...container.querySelectorAll('.run-chip')].map((c) =>
      [...c.querySelectorAll('i')].map((i) => i.style.width),
    )
    expect(widths).toEqual([['50%'], ['50%', '50%']])
  })

  it('shows — for a run still going, and draws no bar for it', () => {
    const { container } = render(
      <RunChips jobs={[job('r', { status: 'running', duration: null })]} max={8} />,
    )
    const chip = container.querySelector('.run-chip')
    expect(chip.className).toBe('run-chip acc')
    expect(chip.textContent).toContain('—')
    expect(chip.querySelectorAll('i').length).toBe(0)
  })

  it('keeps the raw command in the tooltip only', () => {
    const { container } = render(<RunChips jobs={[job('a')]} max={8} />)
    expect(container.textContent).not.toContain('$ C:')
    expect(container.querySelector('.run-chip').title).toBe(CMD)
    // relTime keeps seconds up to 90 s, so a run 60 s old reads `60s`.
    expect(container.textContent).toContain('claude-global · 60s ago')
  })

  it('renders the empty node when there are no runs', () => {
    const { container } = render(<RunChips jobs={[]} max={8} empty={<p>nothing yet</p>} />)
    expect(container.textContent).toBe('nothing yet')
    expect(container.querySelector('.run-chips')).toBeNull()
  })
})
