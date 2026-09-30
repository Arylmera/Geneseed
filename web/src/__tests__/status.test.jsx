import React from 'react'
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import StatusBadge from '../components/StatusBadge.jsx'

describe('StatusBadge', () => {
  it('renders nothing for the approved majority', () => {
    const { container } = render(<StatusBadge status="approved" />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when no status was shipped at all', () => {
    const { container } = render(<StatusBadge status={undefined} />)
    expect(container.innerHTML).toBe('')
  })

  it('flags the states that deviate', () => {
    const { container: warn } = render(<StatusBadge status="experimental" />)
    expect(warn.querySelector('.badge.warn')).toBeTruthy()
    const { container: bad } = render(<StatusBadge status="deprecated" />)
    expect(bad.querySelector('.badge.bad')).toBeTruthy()
    const { container: none } = render(<StatusBadge status="unknown" />)
    expect(none.textContent).toContain('no status')
  })

  it('separates a skill of your own from a registry that says nothing', () => {
    // Both mean "no lifecycle status", but only one is a claim about the entity.
    const { container: mine } = render(<StatusBadge status="personal" />)
    expect(mine.textContent).toContain('personal')
    const { container: none } = render(<StatusBadge status="unknown" />)
    expect(none.textContent).toContain('no status')
  })
})
