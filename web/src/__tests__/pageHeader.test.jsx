import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import PageHeader from '../components/PageHeader.jsx'

// One h1, the subtitle, the action slots in order (secondary before the one primary), and an
// optional breadcrumb whose last item is the current page.
describe('PageHeader', () => {
  it('renders exactly one h1 with the title, and the subtitle', () => {
    render(<PageHeader eyebrow="Harness" title="Constitution" sub="What the agent follows." />)
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
      'Constitution',
    ])
    expect(screen.getByText('What the agent follows.').className).toBe('sub')
    expect(screen.getByText('Harness').className).toBe('eyebrow')
  })

  it('puts the secondary actions before the primary one', () => {
    render(
      <PageHeader
        title="Kits"
        primary={<button className="btn">Apply</button>}
        actions={<button className="btn ghost">Refresh</button>}
      />,
    )
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Refresh', 'Apply'])
  })

  it('renders no action row and no breadcrumb when none are given', () => {
    const { container } = render(<PageHeader title="Kits" />)
    expect(container.querySelector('.page-actions')).toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('marks the last breadcrumb as the current page and links the others', () => {
    render(
      <PageHeader
        title="Spring Boot"
        crumbs={[{ label: 'Kits', href: '#/kits' }, { label: 'Spring Boot' }]}
      />,
    )
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    const items = nav.querySelectorAll('li')
    expect(items.length).toBe(2)
    expect(screen.getByRole('link', { name: 'Kits' }).getAttribute('href')).toBe('#/kits')
    expect(items[1].querySelector('[aria-current="page"]').textContent).toBe('Spring Boot')
    expect(nav.querySelectorAll('[aria-current]').length).toBe(1)
  })
})
