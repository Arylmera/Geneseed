import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

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
  it('lists the six pages in order, then Docs and Activity', () => {
    render(<Sidebar route={{ page: 'overview' }} overview={overview} installs={installs} />)
    expect([...document.querySelectorAll('a.sb-item .sb-label')].map((n) => n.textContent)).toEqual(
      ['Overview', 'Constitution', 'Library', 'Loops', 'Personal', 'Installs', 'Docs', 'Activity'],
    )
  })

  // Each count is a sum the overview already holds, written out:
  //   Constitution = 4 ethos + 11 invariants (retired keep their number) + 28 doctrine = 43
  //   Library      = 52 skills + 18 agents + 2 memory + 2 notebook + 0 wiki + 2 setup = 76
  //   Loops        = templates only (counts.loops), not bricks = 3
  //   Installs     = active of detected, from the installs list = 1/3
  it('counts what each page lists', () => {
    render(<Sidebar route={{ page: 'overview' }} overview={overview} installs={installs} />)
    expect(row('Constitution').querySelector('.sb-count').textContent).toBe('43')
    expect(row('Library').querySelector('.sb-count').textContent).toBe('76')
    expect(row('Loops').querySelector('.sb-count').textContent).toBe('3')
    expect(row('Installs').querySelector('.sb-count').textContent).toBe('1/3')
    // No honest single number for these: no badge rather than an invented one.
    expect(row('Overview').querySelector('.sb-count')).toBeNull()
    expect(row('Personal').querySelector('.sb-count')).toBeNull()
  })

  it('lights the route page, and only it', () => {
    render(<Sidebar route={{ page: 'library', section: 'agents' }} overview={overview} />)
    expect(row('Library').getAttribute('aria-current')).toBe('page')
    expect(document.querySelectorAll('a.sb-item.on')).toHaveLength(1)
  })

  // The vitals: doctor verdict, drift (edited + added + missing = 1 + 0 + 1), the voice.
  it('shows the vitals from the overview', () => {
    render(<Sidebar route={{ page: 'overview' }} overview={overview} />)
    const v = document.querySelector('.sb-vitals')
    expect(v.textContent).toContain('clean')
    expect(v.querySelector('div:nth-child(2) b').textContent).toBe('2')
    expect(screen.getByRole('button', { name: /switch voice|imperial/i })).toBeTruthy()
  })
})

// The phone bar: the same six pages as the rail. At 360px each cell is 60px, so the one
// label that cannot fit at 11px (Constitution) carries its short name; the rail keeps the full one.
describe('TabBar', () => {
  it('carries the six pages, Constitution shortened to fit a phone cell', () => {
    render(<TabBar route={{ page: 'loops' }} />)
    const links = [...document.querySelectorAll('nav.tabbar a')]
    expect(links.map((a) => a.textContent)).toEqual([
      'Overview',
      'Laws',
      'Library',
      'Loops',
      'Personal',
      'Installs',
    ])
    expect(links[3].getAttribute('aria-current')).toBe('page')
  })
})
