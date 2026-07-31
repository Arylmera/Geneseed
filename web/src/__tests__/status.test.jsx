import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../api/index.js', () => ({
  api: {
    catalog: () =>
      Promise.resolve({
        section: 'skills',
        items: [
          { name: 'commit', desc: 'stage and write', klass: 'ship', status: 'approved' },
          { name: 'rule', desc: 'the front door', klass: 'design', status: 'experimental' },
          { name: 'ghost', desc: 'unlisted', klass: 'build', status: 'unknown' },
        ],
      }),
    item: () => Promise.resolve({ body: '', links: [] }),
  },
}))

import StatusBadge from '../components/StatusBadge.jsx'
import Skills from '../pages/Skills.jsx'

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
})
