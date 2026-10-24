import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import Stat from '../components/Stat.jsx'

// jsdom has no matchMedia, so motionOK() is false and the count-up shows its final value.
describe('Stat', () => {
  it('shows the label, the integer value, the delta as text, and the sparkline slot', () => {
    render(
      <Stat label="Skills" value={42} delta="+3 since last week">
        <svg data-testid="spark" />
      </Stat>,
    )
    expect(screen.getByText('Skills').className).toBe('stat-label')
    expect(screen.getByText('42').className).toBe('stat-value mono')
    expect(screen.getByText('+3 since last week')).toBeTruthy()
    expect(screen.getByTestId('spark')).toBeTruthy()
  })

  it('shows a non-integer or non-numeric value as given, never rounded', () => {
    const { rerender } = render(<Stat label="Pass rate" value={99.5} />)
    expect(screen.getByText('99.5')).toBeTruthy()
    rerender(<Stat label="Pass rate" value="—" />)
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('renders no delta line when none is given', () => {
    const { container } = render(<Stat label="Skills" value={0} />)
    expect(screen.getByText('0')).toBeTruthy()
    expect(container.querySelector('.stat-delta')).toBeNull()
  })
})
