import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import Ring from '../components/Ring.jsx'

const arcs = () => [...document.querySelectorAll('path.ring-arc')]
// An SVG arc command, counted in a path's `d`.
const arcCount = (d) => d.split('A ').length - 1

// The three cases a hand-rolled donut got wrong, plus the text alternative.
describe('Ring', () => {
  it('at 0 % draws only the track: no arc, so no NaN path', () => {
    render(<Ring value={0} max={0} label="Checks" />)
    expect(arcs()).toEqual([])
    expect(document.querySelector('circle.ring-track')).not.toBeNull()
    expect(document.body.innerHTML).not.toContain('NaN')
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Checks: 0 of 0')
  })

  it('at 0 of a real max draws only the track, no NaN', () => {
    render(<Ring value={0} max={5} label="Checks" />)
    expect(arcs()).toEqual([])
    expect(document.body.innerHTML).not.toContain('NaN')
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Checks: 0 of 5')
  })

  it('all-zero segments draw no arc either', () => {
    render(<Ring segments={[{ key: 'a', label: 'pass', n: 0 }]} label="Checks" />)
    expect(arcs()).toEqual([])
    expect(document.body.innerHTML).not.toContain('NaN')
  })

  it('at 100 % draws the whole ring as two half-arcs', () => {
    render(<Ring value={7} max={7} label="Checks" />)
    const [only] = arcs()
    expect(arcs().length).toBe(1)
    expect(arcCount(only.getAttribute('d'))).toBe(2)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Checks: 7 of 7')
  })

  it('a single segment holding everything is also two half-arcs', () => {
    render(
      <Ring
        segments={[
          { key: 'a', label: 'pass', n: 5, tone: 'good' },
          { key: 'b', label: 'fail', n: 0, tone: 'bad' },
        ]}
        label="Checks"
      />,
    )
    expect(arcs().length).toBe(1)
    expect(arcCount(arcs()[0].getAttribute('d'))).toBe(2)
  })

  it('a partial ring draws one arc per non-empty part and names every part', () => {
    render(
      <Ring
        segments={[
          { key: 'a', label: 'pass', n: 3, tone: 'good' },
          { key: 'b', label: 'fail', n: 1, tone: 'bad' },
        ]}
        label="Checks"
      />,
    )
    expect(arcs().map((p) => [arcCount(p.getAttribute('d')), p.getAttribute('class')])).toEqual([
      [1, 'ring-arc tone-good'],
      [1, 'ring-arc tone-bad'],
    ])
    // 3 of 4 is more than half the ring: the large-arc flag is set; 1 of 4 is not.
    expect(arcs()[0].getAttribute('d')).toMatch(/ 0 1 1 /)
    expect(arcs()[1].getAttribute('d')).toMatch(/ 0 0 1 /)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Checks: pass: 3 of 4, fail: 1 of 4',
    )
    expect(document.body.innerHTML).not.toContain('NaN')
  })

  it('a value past max is held at a full ring', () => {
    render(<Ring value={9} max={4} label="Budget" />)
    expect(arcCount(arcs()[0].getAttribute('d'))).toBe(2)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Budget: 4 of 4')
  })
})
