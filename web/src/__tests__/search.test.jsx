import React, { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll } from 'vitest'

// The index is the thing under test's INPUT, not its behaviour — stubbed so these assertions
// are about the combobox wiring and nothing else.
const INDEX = [
  {
    kind: 'laws',
    sortKey: 0,
    title: 'law one',
    desc: 'first',
    hay: 'law one',
    route: '#/item/law/I',
  },
  {
    kind: 'laws',
    sortKey: 0,
    title: 'law two',
    desc: 'second',
    hay: 'law two',
    route: '#/item/law/II',
  },
  {
    kind: 'docs',
    sortKey: 1,
    title: 'law docs',
    desc: 'third',
    hay: 'law docs',
    route: '#/docs/x',
  },
]
vi.mock('../hooks/useSearchIndex.js', () => ({
  useSearchIndex: () => ({ index: INDEX, prime: () => {}, error: null }),
}))

import Search from '../components/Search.jsx'

// jsdom implements no layout, so `Element.prototype.scrollIntoView` simply does not exist.
// Spotlight calls it to keep the active row visible, and the resulting TypeError unmounts the
// whole tree — which is why the first draft of these tests reported "no element with role
// combobox" rather than an assertion failure. Stubbed here rather than in a shared setup file:
// this is the only suite that opens the dropdown.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
})

// Search is controlled by the topbar, so the test owns the value the way App does.
function Harness() {
  const [q, setQ] = useState('')
  return <Search value={q} onChange={setQ} />
}

const input = () => screen.getByRole('combobox')
const openWith = (text) => {
  fireEvent.focus(input())
  fireEvent.change(input(), { target: { value: text } })
}

// ⚠ WHAT THESE PIN, AND WHY THEY EXIST. The dropdown was already a correct `listbox` of
// `option`s carrying `aria-selected` — and none of it was reachable, because nothing tied the
// list to the input that drives it. Focus never leaves the input in this pattern, so a screen
// reader learns which row is current from `aria-activedescendant` ALONE; without it the arrow
// keys moved a purely visual highlight. Every assertion below fails against that version.
describe('Spotlight combobox wiring', () => {
  it('declares itself a combobox and stays collapsed until there is a query', () => {
    render(<Harness />)
    expect(input().getAttribute('aria-expanded')).toBe('false')
    expect(input().getAttribute('aria-autocomplete')).toBe('list')
    // No list is rendered, so there is nothing to point at — an `aria-controls` naming an
    // absent id would be its own defect.
    expect(input().getAttribute('aria-controls')).toBeNull()
    expect(input().getAttribute('aria-activedescendant')).toBeNull()
  })

  it('points at the rendered listbox once open, by an id that is really in the document', () => {
    render(<Harness />)
    openWith('law')
    expect(input().getAttribute('aria-expanded')).toBe('true')
    const listId = input().getAttribute('aria-controls')
    expect(listId).toBe('spotlight-list')
    const list = document.getElementById(listId)
    expect(list).toBeTruthy()
    expect(list.getAttribute('role')).toBe('listbox')
  })

  it('names the active row, and follows it down the list', () => {
    render(<Harness />)
    openWith('law')
    const opts = screen.getAllByRole('option')
    expect(opts.length).toBeGreaterThan(1)

    // THE ASSERTION THE OLD MARKUP COULD NOT SATISFY: the id the input advertises must be the
    // row that is actually selected, not merely the one that looks highlighted.
    const first = input().getAttribute('aria-activedescendant')
    expect(first).toBe(opts[0].id)
    expect(opts[0].getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    const second = input().getAttribute('aria-activedescendant')
    expect(second).not.toBe(first)
    expect(second).toBe(screen.getAllByRole('option')[1].id)
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true')
  })

  it('owns its options through groups, never through bare divs', () => {
    render(<Harness />)
    openWith('law')
    // A listbox may own `option`s and `group`s and nothing else. The section headings used to
    // be plain divs sitting between the two, which made every option below an invalid child.
    for (const opt of screen.getAllByRole('option')) {
      expect(opt.parentElement.getAttribute('role')).toBe('group')
    }
    // ...and the heading is the group's own label, so it must not also be read as content.
    expect(document.querySelector('.spot-group-head').getAttribute('aria-hidden')).toBe('true')
  })

  it('says how many results there are, which aria-expanded cannot', () => {
    render(<Harness />)
    openWith('law')
    const live = document.querySelector('[role="status"]')
    expect(live.getAttribute('aria-live')).toBe('polite')
    expect(live.textContent).toMatch(/3 results/)

    // Narrowing to nothing is the case a sighted user reads off an empty list for free.
    fireEvent.change(input(), { target: { value: 'zzzznomatch' } })
    expect(document.querySelector('[role="status"]').textContent).toMatch(/no matches/)
  })
})
