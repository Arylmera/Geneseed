import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// The real HarnessSelector, unlike topbar.test.jsx: these tests are about where it sits.
vi.mock('../components/Search.jsx', () => ({ default: () => null }))

import Topbar from '../components/Topbar.jsx'

const overview = { install: { host: 'claude', scope: 'global' }, target: '/home/u/.claude' }
const two = [
  { id: 'a', host: 'claude', scope: 'global', state: 'active', selected: true },
  { id: 'b', host: 'opencode', scope: 'global', state: 'active' },
  { id: 'c', host: 'bob', scope: 'global', state: 'disabled' },
]
const mount = (installs) =>
  render(<Topbar route={{ page: 'library' }} overview={overview} installs={installs} />)
const crumbs = () => screen.getByRole('navigation', { name: 'Breadcrumb' })

// The breadcrumb's root names the install the console reads; where there is a second active
// install to read instead, that root IS the picker (the mockup's install button), so the
// topbar no longer carries a second, detached copy of the same fact on its right.
describe('Topbar install root', () => {
  it('is the harness picker, first in the breadcrumb, when two installs are active', () => {
    mount(two)
    const pick = within(crumbs()).getByRole('combobox', { name: 'Harness to view' })
    expect(pick.closest('li')).toBe(crumbs().querySelector('li'))
    expect(screen.getAllByRole('combobox', { name: 'Harness to view' })).toHaveLength(1)
    expect(within(crumbs()).queryByRole('link', { name: 'claude:global' })).toBeNull()
  })

  it('stays the link to Installs when there is nothing to switch to', () => {
    mount([two[0], two[2]])
    expect(screen.queryByRole('combobox', { name: 'Harness to view' })).toBeNull()
    expect(within(crumbs()).getByRole('link', { name: 'claude:global' }).getAttribute('href')).toBe(
      '#/installs',
    )
  })
})
