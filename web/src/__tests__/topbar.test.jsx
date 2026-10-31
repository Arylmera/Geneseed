import React from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// The two neighbours fetch and own their own behaviour; these tests are about the crumbs and
// the Appearance popover only.
vi.mock('../components/Search.jsx', () => ({ default: () => null }))

import Topbar from '../components/Topbar.jsx'

const appearance = {
  flavour: 'cultivar',
  onFlavour: () => {},
  accentMode: 'curated',
  onAccentMode: () => {},
  layout: 'board',
  onLayout: () => {},
}
// Inside `.app`, as App renders it: the popover portals to the nearest `.app`.
const mount = (route = { page: 'overview' }) =>
  render(
    <div className="app">
      <Topbar route={route} appearance={appearance} />
    </div>,
  )
const trigger = () => screen.getByRole('button', { name: 'Appearance' })

// The popover used to render inside the sticky topbar, whose own stacking context (--z-sticky)
// capped its --z-pop: the phone drawer and its scrim covered it. Out of the topbar it is
// above them; the shared Popover gives it the keyboard half (focus in, Escape out).
describe('Appearance popover', () => {
  it('renders outside the topbar, under .app', () => {
    mount()
    fireEvent.click(trigger())
    const pop = screen.getByRole('dialog', { name: 'Appearance' })
    expect(pop.closest('.topbar')).toBeNull()
    expect(pop.closest('.app')).not.toBeNull()
  })

  it('moves focus to the first Skin button on open', () => {
    mount()
    fireEvent.click(trigger())
    const pop = screen.getByRole('dialog', { name: 'Appearance' })
    expect(document.activeElement).toBe(within(pop).getAllByRole('button')[0])
  })

  it('Escape closes it and focus returns to the trigger', () => {
    mount()
    fireEvent.click(trigger())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Appearance' })).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })
})

// A breadcrumb is an ordered list (the WAI pattern, and PageHeader's); every level above the
// current one is a link back to it, and the current one is aria-current="page". It starts at the
// page: no install root, since the console has no install-wide view (each page picks its own).
describe('Breadcrumb', () => {
  it('is an ordered list whose parent levels link back, the tab current', () => {
    mount({ page: 'installs', tab: 'kits' })
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(nav.querySelector('ol')).not.toBeNull()
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([['Installs', '#/installs']])
    expect(nav.querySelector('[aria-current="page"]').textContent).toBe('Kits')
  })

  it('a page without a tab is itself the current level, not a link', () => {
    mount({ page: 'overview' })
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(nav).queryAllByRole('link')).toEqual([])
    expect(nav.querySelectorAll('li')).toHaveLength(1)

    expect(nav.querySelector('[aria-current="page"]').textContent).toBe('Overview')
  })
})
