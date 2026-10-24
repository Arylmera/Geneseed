import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import EmptyState from '../components/EmptyState.jsx'

// An empty state names what is missing and offers the way out: an action and a docs link.
describe('EmptyState', () => {
  it('shows the title, the explanation, the action and the docs link', () => {
    const { container } = render(
      <EmptyState
        title="No kits yet"
        action={<button className="btn">Browse kits</button>}
        docs={{ href: '#/docs/kits', label: 'What is a kit?' }}
      >
        A kit bundles skills for one stack.
      </EmptyState>,
    )
    expect(container.firstChild.className).toBe('empty')
    expect(screen.getByText('No kits yet').className).toBe('big')
    expect(screen.getByText('A kit bundles skills for one stack.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Browse kits' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'What is a kit?' }).getAttribute('href')).toBe(
      '#/docs/kits',
    )
  })

  it('renders no action row when there is neither an action nor docs', () => {
    const { container } = render(<EmptyState title="Nothing here" />)
    expect(container.querySelector('.empty-actions')).toBeNull()
  })
})
