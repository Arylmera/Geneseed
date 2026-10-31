import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import InstallPicker, { InstallListStatus } from '../components/InstallPicker.jsx'

const OC = { id: 'oc', host: 'opencode', scope: 'global', path: '/oc', state: 'active' }
const R = { id: 'r', host: 'bob', scope: 'project', path: '/x/repo', state: 'active' }

describe('InstallPicker', () => {
  it('names each install by its tag, under its own label', () => {
    render(<InstallPicker installs={[OC, R]} value={R} onChange={() => {}} label="Write to:" />)
    const pick = screen.getByRole('combobox', { name: 'Write to:' })
    expect([pick.value, [...pick.options].map((o) => o.textContent)]).toEqual([
      'r',
      ['opencode · global', 'repo · bob'],
    ])
  })

  it('shows nothing with one install', () => {
    const { container } = render(
      <InstallPicker installs={[OC]} value={OC} onChange={() => {}} label="Write to:" />,
    )
    expect(container.innerHTML).toBe('')
  })
})

// An unreadable install list is said once, so a page with no picker is not mistaken for a
// one-install machine.
describe('InstallListStatus', () => {
  it('says the list is unreadable, and nothing otherwise', () => {
    const { rerender, container } = render(<InstallListStatus unreadable />)
    expect(screen.getByRole('status').textContent).toBe(
      'Install list unreadable — showing the default install.',
    )
    rerender(<InstallListStatus unreadable={false} />)
    expect(container.innerHTML).toBe('')
  })
})
