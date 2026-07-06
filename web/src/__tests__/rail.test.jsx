import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import Rail from '../components/Rail.jsx'

const overview = { counts: { agents: 16, skills: 25, laws: 20 }, theme: 'ember' }

// The rail no longer expands sub-menus for Library or Docs — both pages own
// their own horizontal chip-bar now. These tests cover what the rail still
// owns: lighting up the right top-level item for each route and showing the
// new Laws tab between Dashboard and Library.
describe('Rail navigation', () => {
  it('lights up Library on the landing route', () => {
    render(<Rail route={{ view: 'library' }} overview={overview} />)
    const libraryLink = screen.getByText('Library').closest('a')
    expect(libraryLink.getAttribute('href')).toBe('#/library')
    expect(libraryLink.className).toContain('active')
  })

  it('keeps Library lit on section + item routes', () => {
    // Library owns every section except laws and skills (those have their own tabs).
    render(<Rail route={{ view: 'section', section: 'memory' }} overview={overview} />)
    expect(screen.getByText('Library').closest('a').className).toContain('active')
  })

  it('keeps Library lit on an item-detail route', () => {
    render(<Rail route={{ view: 'item', type: 'memory', name: 'some-fact' }} overview={overview} />)
    expect(screen.getByText('Library').closest('a').className).toContain('active')
  })

  it('exposes Agents as its own rail entry and claims agent item routes', () => {
    render(<Rail route={{ view: 'item', type: 'agent', name: 'advocate' }} overview={overview} />)
    const agentsLink = screen.getByText('Agents').closest('a')
    expect(agentsLink.getAttribute('href')).toBe('#/agents')
    expect(agentsLink.className).toContain('active')
    // Library must NOT also light up for agent items anymore
    expect(screen.getByText('Library').closest('a').className).not.toContain('active')
    // count badge sourced from overview.counts.agents
    expect(agentsLink.textContent).toContain('16')
  })

  it('exposes Laws as its own rail entry between Dashboard and Library', () => {
    render(<Rail route={{ view: 'laws' }} overview={overview} />)
    const lawsLink = screen.getByText('Laws').closest('a')
    expect(lawsLink.getAttribute('href')).toBe('#/laws')
    expect(lawsLink.className).toContain('active')
    // count badge sourced from overview.counts.laws
    expect(lawsLink.textContent).toContain('20')
  })

  it('exposes Activity as its own rail entry', () => {
    render(<Rail route={{ view: 'activity' }} overview={overview} />)
    const link = screen.getByText('Activity').closest('a')
    expect(link.getAttribute('href')).toBe('#/activity')
    expect(link.className).toContain('active')
  })

  it('does not render section sub-items in the rail', () => {
    render(<Rail route={{ view: 'library' }} overview={overview} />)
    // Library's sections (Memory, Notebook, Wiki, …) live in the Library
    // chip-bar, not the rail. Skills and Laws are the exceptions — each is now
    // its own top-level rail entry.
    expect(screen.queryByText('Memory')).toBeNull()
  })
})
