import React from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import Sidebar, { TabBar } from '../components/Sidebar.jsx'

const overview = {
  counts: {
    agents: 18,
    skills: 52,
    laws: 11,
    ontology: 4,
    doctrines: { active: 5, total: 5, rules: 28 },
    memory: 2,
    notebook: 2,
    wiki: 0,
    config: 2,
    loops: 3,
  },
  theme: 'imperial',
  version: '3.8.0',
  doctor: { ok: true, problems: [] },
  diff: { edited: 1, added: 0, missing: 1 },
}
const installs = [
  { id: 'a', state: 'active' },
  { id: 'b', state: 'absent' },
  { id: 'c', state: 'disabled' },
]

const row = (label) => screen.getByText(label).closest('a')

describe('Sidebar', () => {
  it('lists the pages in group order', () => {
    render(<Sidebar route={{ page: 'overview' }} overview={overview} installs={installs} />)
    expect([...document.querySelectorAll('a.sb-item .sb-label')].map((n) => n.textContent)).toEqual(
      [
        'Overview',
        'Constitution',
        'Personal',
        'Library',
        'Kits',
        'Loops',
        'Factories',
        'Installs',
        'Activity',
        'Docs',
        'Settings',
      ],
    )
  })

  // Each count is a sum the overview already holds, written out:
  //   Constitution = 11 invariants (counts.laws) + 28 doctrine = 39; the 4 ethos sections are no rules
  //   Library      = 52 skills + 18 agents + 0 wiki + 2 setup = 72; memory and notebook are Personal's
  //   Loops        = templates only (counts.loops), not bricks = 3
  //   Installs     = installed, on or off, from the installs list = 2 of the 3 rows
  it('counts what each page lists', () => {
    render(<Sidebar route={{ page: 'overview' }} overview={overview} installs={installs} />)
    expect(row('Constitution').querySelector('.sb-count').textContent).toBe('39')
    expect(row('Library').querySelector('.sb-count').textContent).toBe('72')
    expect(row('Loops').querySelector('.sb-count').textContent).toBe('3')
    expect(row('Installs').querySelector('.sb-count').textContent).toBe('2')
    // No honest single number for these: no badge rather than an invented one.
    expect(row('Overview').querySelector('.sb-count')).toBeNull()
    expect(row('Personal').querySelector('.sb-count')).toBeNull()
  })

  it('lights the route page, and only it', () => {
    render(<Sidebar route={{ page: 'library', section: 'agents' }} overview={overview} />)
    expect(row('Library').getAttribute('aria-current')).toBe('page')
    expect(document.querySelectorAll('a.sb-item.on')).toHaveLength(1)
  })

  // The groups, each a named region: the Overview alone, then Govern, Build, Run and Help,
  // with the pages the owner placed in each.
  it('groups the pages under Govern, Build, Run and Help', () => {
    render(<Sidebar route={{ page: 'overview' }} overview={overview} installs={installs} />)
    const nav = screen.getByRole('navigation', { name: 'Console' })
    const names = (g) =>
      within(g)
        .getAllByRole('link')
        .map((a) => a.querySelector('.sb-label').textContent)
    expect(names(within(nav).getByRole('group', { name: 'Overview' }))).toEqual(['Overview'])
    expect(names(within(nav).getByRole('group', { name: 'Govern' }))).toEqual([
      'Constitution',
      'Personal',
    ])
    expect(names(within(nav).getByRole('group', { name: 'Build' }))).toEqual([
      'Library',
      'Kits',
      'Loops',
      'Factories',
    ])
    expect(names(within(nav).getByRole('group', { name: 'Run' }))).toEqual(['Installs', 'Activity'])
    expect(names(within(nav).getByRole('group', { name: 'Help' }))).toEqual(['Docs', 'Settings'])
    expect(nav.querySelectorAll('a.sb-item')).toHaveLength(11)
  })

  // The owner's order for Build: Library, Kits, Loops, and last Factories, right after Loops.
  // Factories carries no badge: the overview counts no factories (railCounts holds every badge
  // to what its page lists).
  it('places Factories in Build, right after Library, Kits and Loops', () => {
    render(<Sidebar route={{ page: 'factories' }} overview={overview} installs={installs} />)
    const build = within(screen.getByRole('navigation', { name: 'Console' })).getByRole('group', {
      name: 'Build',
    })
    const labels = within(build)
      .getAllByRole('link')
      .map((a) => a.querySelector('.sb-label').textContent)
    expect(labels.slice(-4)).toEqual(['Library', 'Kits', 'Loops', 'Factories'])
    expect(labels.indexOf('Factories')).toBe(labels.indexOf('Loops') + 1)
    expect(row('Factories').getAttribute('href')).toBe('#/factories')
    expect(row('Factories').getAttribute('aria-current')).toBe('page')
    expect(row('Factories').querySelector('.sb-count')).toBeNull()
  })

  // Voice is switched on Installs, per install; the rail offers no switch at any width.
  it('offers no voice switch', () => {
    render(<Sidebar route={{ page: 'overview' }} overview={overview} />)
    expect(screen.queryByRole('button', { name: /voice/i })).toBeNull()
  })

  it('carries no vitals card', () => {
    render(<Sidebar route={{ page: 'overview' }} overview={overview} />)
    expect(document.querySelector('.sb-vitals')).toBeNull()
    expect(screen.queryByRole('region', { name: /vitals/i })).toBeNull()
  })

  it('marks the active entry with aria-current and the raised class, and no other', () => {
    render(<Sidebar route={{ page: 'kits' }} overview={overview} installs={installs} />)
    const on = document.querySelectorAll('a.sb-item[aria-current="page"]')
    expect(on).toHaveLength(1)
    expect(on[0].classList.contains('on')).toBe(true)
    expect(on[0].textContent).toContain('Kits')
  })

  // Collapsing is the viewer's: the rail keeps chips only, every link names itself for a screen
  // reader and a tooltip, the choice is stored, and expanding undoes it.
  describe('collapse', () => {
    beforeEach(() => localStorage.clear())

    it('collapses to chips with named links, remembers it, and expands again', () => {
      const { unmount } = render(
        <Sidebar route={{ page: 'overview' }} overview={overview} installs={installs} />,
      )
      const nav = screen.getByRole('navigation', { name: 'Console' })
      expect(nav.classList.contains('collapsed')).toBe(false)
      expect(row('Library').getAttribute('aria-label')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Collapse the sidebar' }))
      expect(nav.classList.contains('collapsed')).toBe(true)
      expect(row('Library').getAttribute('aria-label')).toBe('Library, 72')
      expect(row('Library').getAttribute('title')).toBe('Library')
      expect(row('Overview').getAttribute('aria-label')).toBe('Overview')
      expect(localStorage.getItem('geneseed-rail')).toBe('collapsed')
      unmount()
      render(<Sidebar route={{ page: 'overview' }} overview={overview} installs={installs} />)
      expect(
        screen.getByRole('navigation', { name: 'Console' }).classList.contains('collapsed'),
      ).toBe(true)
      fireEvent.click(screen.getByRole('button', { name: 'Expand the sidebar' }))
      expect(
        screen.getByRole('navigation', { name: 'Console' }).classList.contains('collapsed'),
      ).toBe(false)
      expect(localStorage.getItem('geneseed-rail')).toBe('open')
    })
  })
})

describe('TabBar', () => {
  it('carries four pages with their full names, then More', () => {
    render(<TabBar route={{ page: 'library' }} />)
    const links = [...document.querySelectorAll('nav.tabbar a')]
    expect(links.map((a) => a.textContent)).toEqual([
      'Overview',
      'Constitution',
      'Library',
      'Installs',
    ])
    expect(links[2].getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: 'More' }).classList.contains('on')).toBe(false)
  })

  it('More opens the drawer, and is lit on a page only the drawer lists', () => {
    const onMore = vi.fn()
    render(<TabBar route={{ page: 'loops' }} navOpen={false} onMore={onMore} />)
    const more = screen.getByRole('button', { name: 'More' })
    expect(more.getAttribute('aria-controls')).toBe('rail-nav')
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(more.classList.contains('on')).toBe(true)
    fireEvent.click(more)
    expect(onMore).toHaveBeenCalledTimes(1)
  })
})
