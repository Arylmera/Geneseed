import React from 'react'
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
// No pages and no actions: the counts below are the three items alone.
vi.mock('../hooks/useSearchIndex.js', () => ({
  useSearchIndex: () => ({ index: INDEX, prime: () => {}, error: null }),
  PAGE_ENTRIES: [],
}))

import Search from '../components/Search.jsx'
import Spotlight, { filterAndRank } from '../components/Spotlight.jsx'

// jsdom implements no layout, so `Element.prototype.scrollIntoView` simply does not exist.
// Spotlight calls it to keep the active row visible, and the resulting TypeError unmounts the
// whole tree — which is why the first draft of these tests reported "no element with role
// combobox" rather than an assertion failure. Stubbed here rather than in a shared setup file:
// this is the only suite that opens the dropdown.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
})

// The palette owns its query; the combobox exists only once the trigger has opened it.
const Harness = () => <Search />

const input = () => screen.getByRole('combobox')
const openWith = (text) => {
  fireEvent.click(screen.getByRole('button', { name: /Search or run/ }))
  fireEvent.change(input(), { target: { value: text } })
}

// ⚠ WHAT THESE PIN, AND WHY THEY EXIST. The dropdown was already a correct `listbox` of
// `option`s carrying `aria-selected` — and none of it was reachable, because nothing tied the
// list to the input that drives it. Focus never leaves the input in this pattern, so a screen
// reader learns which row is current from `aria-activedescendant` ALONE; without it the arrow
// keys moved a purely visual highlight. Every assertion below fails against that version.
describe('Spotlight combobox wiring', () => {
  it('renders no combobox until the palette opens, and an expanded one inside it', () => {
    render(<Harness />)
    expect(screen.queryByRole('combobox')).toBeNull()
    openWith('')
    // Open with an empty query, it still lists (actions and pages; none here), so the list
    // is in the document and `aria-controls` names a real id from the first frame.
    expect(input().getAttribute('aria-expanded')).toBe('true')
    expect(input().getAttribute('aria-autocomplete')).toBe('list')
    expect(document.getElementById(input().getAttribute('aria-controls'))).toBeTruthy()
    // Nothing to list here, so nothing to name.
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

// VS-21: the ranking once visited one kind twice (skills, docs, skills), and a key on the kind
// alone left the first run's rows on screen after the next keystroke. Groups are now one run per
// kind (grouped first, ranked inside), and a narrower query must still leave no stale row.
describe('Spotlight groups', () => {
  const S = (title) => ({ kind: 'skills', sortKey: 0, title, hay: title, route: `#/s/${title}` })
  const IDX = [
    S('debug'),
    S('deck'),
    S('node deletion'),
    { kind: 'docs', sortKey: 3, title: 'deletion', hay: 'deletion', route: '#/docs/deletion' },
  ]
  const props = { index: IDX, active: 0, onActive: () => {}, onPick: () => {} }
  const titles = () => [...document.querySelectorAll('.spot-title')].map((n) => n.textContent)

  it('opens one group per kind, so a narrower query leaves no stale row', () => {
    const { rerender } = render(<Spotlight query="de" {...props} />)
    // "de": the skill that only contains it stays in the skills group (sortKey 0), above the
    // docs title that starts with it (sortKey 3).
    expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual([
      'skills',
      'docs',
    ])
    expect(titles()).toEqual(['debug', 'deck', 'node deletion', 'deletion'])
    rerender(<Spotlight query="del" {...props} />)
    expect(titles()).toEqual(['node deletion', 'deletion'])
    expect(titles()).toEqual(filterAndRank(IDX, 'del').map((e) => e.title))
  })

  // With nothing typed there is nothing to rank: the rows that need no query (sortKey < 0,
  // actions then pages) in that order, and no items.
  it('lists actions then pages, and no items, for an empty query', () => {
    const page = { kind: 'Pages', sortKey: -1, title: 'Kits', hay: 'kits', route: '#/kits' }
    const act = { kind: 'Actions', sortKey: -2, title: 'Run doctor', hay: 'run doctor' }
    expect(filterAndRank([...IDX, page, act], '  ').map((e) => e.title)).toEqual([
      'Run doctor',
      'Kits',
    ])
  })
})
