import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The catalog payload is per-test: the Personal chip is conditional, so proving it
// appears is only half the check — it must also stay away from an install that has
// no skills of your own. vi.hoisted keeps the box reachable from the hoisted factory.
const box = vi.hoisted(() => ({ items: [] }))

vi.mock('../api/index.js', () => ({
  api: {
    catalog: () => Promise.resolve({ section: 'skills', items: box.items }),
    item: () => Promise.resolve({ body: '', links: [] }),
  },
}))

import StatusBadge from '../components/StatusBadge.jsx'
import Skills from '../pages/Skills.jsx'

const SHIPPED = [
  { name: 'commit', desc: 'stage and write', klass: 'ship', status: 'approved' },
  { name: 'rule', desc: 'the front door', klass: 'design', status: 'experimental' },
  { name: 'ghost', desc: 'unlisted', klass: 'build', status: 'unknown' },
]
const MINE = { name: 'scribe-readme', desc: 'my own', klass: 'personal', status: 'personal' }

// Chip-bar labels only: "Personal" also appears as a row's class column, so a bare
// getByText would match either and pass for the wrong reason.
// (the label span only — the dot and the count sit in the same button).
const chips = (c) =>
  [...c.querySelectorAll('.law-cats .law-cat')].map(
    (b) => b.querySelector('span:not(.cdot):not(.cn)')?.textContent,
  )

beforeEach(() => {
  box.items = SHIPPED
})

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

describe('Skills lifecycle statuses', () => {
  it('badges only the non-approved skills and counts them in the readout', async () => {
    const { container } = render(<Skills />)
    await waitFor(() => expect(screen.getByText('commit')).toBeTruthy())
    // Three skills, but only the two that deviate carry a badge.
    expect(container.querySelectorAll('.skill-row .badge').length).toBe(2)
    expect(screen.getByText('experimental')).toBeTruthy()
    expect(container.querySelector('.law-readout').textContent).toContain('1 experimental')
  })

  it('hides the Personal chip when every skill is one Geneseed ships', async () => {
    const { container } = render(<Skills />)
    await waitFor(() => expect(screen.getByText('commit')).toBeTruthy())
    expect(chips(container)).not.toContain('Personal')
    expect(container.querySelector('.law-readout').textContent).toContain('6 classes')
  })

  it('gives skills of your own their own chip, outside the six classes', async () => {
    box.items = [...SHIPPED, MINE]
    const { container } = render(<Skills />)
    await waitFor(() => expect(screen.getByText('scribe-readme')).toBeTruthy())
    expect(chips(container)).toContain('Personal')
    expect(container.querySelector('.law-readout').textContent).toContain('7 classes')
    // Its row is classed Personal, not swept into the Build fallback.
    const row = [...container.querySelectorAll('.skill-row')].find((r) =>
      r.textContent.includes('scribe-readme'),
    )
    expect(row.querySelector('.law-class').textContent).toContain('Personal')
    expect(row.querySelector('.badge').textContent).toContain('personal')
  })
})
