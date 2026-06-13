import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import Rail from '../components/Rail.jsx'

const overview = { counts: { agents: 16, skills: 25, laws: 20 }, theme: 'ember' }

describe('Rail library sub-menu', () => {
  it('expands Library into its sections while browsing the library', () => {
    render(<Rail route={{ view: 'section', section: 'skills' }} overview={overview} />)
    // sections render as nested sub-items with their live counts
    const skills = screen.getByText('Skills').closest('a')
    expect(skills.getAttribute('href')).toBe('#/section/skills')
    expect(skills.className).toContain('active')
    expect(screen.getByText('16')).toBeTruthy() // agents count
    // a non-active section is present but not lit
    expect(screen.getByText('Laws').closest('a').className).not.toContain('active')
  })

  it('keeps the owning section lit on an item-detail route', () => {
    render(<Rail route={{ view: 'item', type: 'agent', name: 'advocate' }} overview={overview} />)
    expect(screen.getByText('Agents').closest('a').className).toContain('active')
  })

  it('hides the sub-menu outside the library', () => {
    render(<Rail route={{ view: 'dashboard' }} overview={overview} />)
    expect(screen.queryByText('Skills')).toBeNull()
  })

  it('keeps the landing collapsed — the genome grid is the expanded view there', () => {
    render(<Rail route={{ view: 'library' }} overview={overview} />)
    expect(screen.queryByText('Skills')).toBeNull()
  })
})
