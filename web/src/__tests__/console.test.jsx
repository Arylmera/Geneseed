import React from 'react'
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import Console from '../components/Console.jsx'

// The console's two motion cues are state, not decoration, so they are pinned here:
// the scan bar exists exactly while a job runs, and the end of a WATCHED job flashes
// the head in the colour of its outcome. `finish` is an event object, so a re-render
// with the same object must not flash again, and a new object must.
describe('Console motion cues', () => {
  const head = (c) => c.querySelector('.console-head')

  it('shows the scan bar only while busy', () => {
    const { container, rerender } = render(<Console runs={[]} open={false} busy />)
    expect(container.querySelector('.console-progress')).not.toBeNull()
    rerender(<Console runs={[]} open={false} busy={false} />)
    expect(container.querySelector('.console-progress')).toBeNull()
  })

  it('flashes green for done and red for failed', () => {
    const { container, rerender } = render(<Console runs={[]} open={false} finish={null} />)
    expect(head(container).className).toBe('console-head')
    rerender(<Console runs={[]} open={false} finish={{ status: 'done', at: 1 }} />)
    expect(head(container).classList.contains('flash-ok')).toBe(true)
    rerender(<Console runs={[]} open={false} finish={{ status: 'failed', at: 2 }} />)
    expect(head(container).classList.contains('flash-bad')).toBe(true)
    expect(head(container).classList.contains('flash-ok')).toBe(false)
  })
})
