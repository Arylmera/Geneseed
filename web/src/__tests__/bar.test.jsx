import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import StackBar, { Bar } from '../components/StackBar.jsx'

const parts = [
  { key: 'pass', label: 'pass', n: 3, tone: 'good' },
  { key: 'warn', label: 'warn', n: 1, tone: 'warn' },
  { key: 'fail', label: 'fail', n: 0, tone: 'bad' },
]

// No part reads by colour alone: the bar is an image labelled with every part, each drawn
// segment has a title, and the legend prints each label with its count. Without motion
// (jsdom) the widths are final on the first render.
describe('StackBar', () => {
  it('labels the bar with every part as "label: n of total"', () => {
    render(<StackBar parts={parts} label="Doctor checks" />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Doctor checks: pass: 3 of 4, warn: 1 of 4, fail: 0 of 4',
    )
  })

  it('draws final widths for the non-empty parts, each with a title and its tone', () => {
    render(<StackBar parts={parts} label="Doctor checks" />)
    const segs = [...screen.getByRole('img').children]
    expect(segs.map((s) => [s.style.width, s.getAttribute('title'), s.className])).toEqual([
      ['75%', 'pass: 3', 'tone-good'],
      ['25%', 'warn: 1', 'tone-warn'],
    ])
  })

  it('the legend prints every label beside its count, zero included', () => {
    const { container } = render(<StackBar parts={parts} />)
    expect(
      [...container.querySelectorAll('.stackbar-legend li')].map((li) => li.textContent),
    ).toEqual(['pass 3', 'warn 1', 'fail 0'])
  })

  it('an explicit total leaves the rest as track, and an all-zero bar divides by nothing', () => {
    const { rerender } = render(
      <StackBar parts={[{ key: 'a', label: 'used', n: 1, tone: 'accent' }]} total={4} />,
    )
    expect(screen.getByRole('img').firstChild.style.width).toBe('25%')
    rerender(<StackBar parts={[{ key: 'a', label: 'used', n: 0 }]} />)
    expect(screen.getByRole('img').children.length).toBe(0)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('used: 0 of 0')
  })
})

describe('Bar', () => {
  it('is one part of a max', () => {
    render(<Bar label="Budget" value={3} max={12} />)
    const img = screen.getByRole('img')
    expect(img.getAttribute('aria-label')).toBe('Budget: 3 of 12')
    expect(img.firstChild.style.width).toBe('25%')
  })

  // Every caller prints the label and the count beside the bar; a legend would say it twice.
  it('prints no legend: its one part is already named beside it', () => {
    const { container } = render(<Bar label="Budget" value={3} max={12} />)
    expect(container.querySelector('.stackbar-legend')).toBeNull()
  })

  it('clamps to [0, max] and never reads "undefined" without a label', () => {
    const { rerender } = render(<Bar value={9} max={4} />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('value: 4 of 4')
    expect(screen.getByRole('img').firstChild.style.width).toBe('100%')
    rerender(<Bar value={-2} max={4} />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('value: 0 of 4')
    expect(screen.getByRole('img').children.length).toBe(0)
  })
})
