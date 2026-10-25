import React from 'react'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The Docs in the Library's three panes: a rail of parts with their page counts, the open
// part's pages under `● SECTION` headings, and the page with its breadcrumb and a
// Previous / Next that stays inside the section. The address stays `#/docs/<id>`.
vi.mock('../api/index.js', () => ({ api: { docs: vi.fn(), docsPage: vi.fn() } }))
vi.mock('../lib/router.js', () => ({ go: vi.fn() }))

import Docs, { docRows } from '../pages/Docs/index.jsx'
import { filterRows } from '../components/LibRows.jsx'
import { api } from '../api/index.js'

// Sections arrive grouped (the server's bySection): Install, then General.
const MENU = {
  harness: 'opencode',
  groups: [
    {
      id: 'understand',
      label: 'Understand',
      pages: [
        { id: 'harness', title: 'What a harness is', kind: 'concept', section: 'General' },
        { id: 'machine', title: 'What lands', kind: 'concept', section: 'General' },
      ],
    },
    {
      id: 'guides',
      label: 'Guides',
      pages: [
        {
          id: 'quick',
          title: 'Quick start',
          kind: 'concept',
          section: 'Install',
          description: 'one command',
        },
        { id: 'clone', title: 'From a clone', kind: 'concept', section: 'Install' },
        { id: 'verify', title: 'Verify it works', kind: 'concept', section: 'General' },
      ],
    },
  ],
}

beforeEach(() => {
  localStorage.clear()
  api.docs.mockResolvedValue(MENU)
  api.docsPage.mockImplementation((id) =>
    id === 'glossary'
      ? Promise.resolve({ rows: [] })
      : Promise.resolve({ id, kind: 'concept', title: id, body: `## ${id} heading\n\ntext` }),
  )
})
afterEach(() => vi.clearAllMocks())

const texts = (sel) => [...document.querySelectorAll(sel)].map((n) => n.textContent)

describe('Docs layout', () => {
  it('rows carry the section as their group and the description as their line', () => {
    expect(docRows(MENU.groups[1]).map((r) => [r.group, r.name, r.desc])).toEqual([
      ['Install', 'quick', 'one command'],
      ['Install', 'clone', ''],
      ['General', 'verify', ''],
    ])
    expect(docRows({ pages: [{ id: 'x', title: 'X' }] })[0].group).toBe('General')
  })

  it('filters on title and description', () => {
    const rows = docRows(MENU.groups[1])
    expect(filterRows(rows, 'ONE COMM').map((r) => r.name)).toEqual(['quick'])
    expect(filterRows(rows, 'clone').map((r) => r.name)).toEqual(['clone'])
    expect(filterRows(rows, '  ').map((r) => r.name)).toEqual(['quick', 'clone', 'verify'])
  })

  it('lists the parts with counts, the part pages by section, and the breadcrumb', async () => {
    render(<Docs page="clone" overview={{}} />)
    await waitFor(() => expect(texts('.lib-group')).toEqual(['Install', 'General']))
    expect(
      [...document.querySelectorAll('.kind-list a')].map((a) => [
        a.firstChild.textContent,
        a.querySelector('.mono').textContent,
        a.getAttribute('aria-current'),
        a.getAttribute('href'),
      ]),
    ).toEqual([
      ['Understand', '2', null, '#/docs/harness'],
      ['Guides', '3', 'page', '#/docs/quick'],
    ])
    expect(texts('.lib-rows .lr-name')).toEqual(['Quick start', 'From a clone', 'Verify it works'])
    expect(document.querySelector('.lib-row.on').getAttribute('href')).toBe('#/docs/clone')
    expect(texts('.docs-crumbs a, .docs-crumbs [aria-current]')).toEqual([
      'Guides',
      'Install',
      'From a clone',
    ])
    // The section crumb opens the section's first page.
    expect(texts('.docs-crumbs a')).toEqual(['Guides', 'Install'])
    expect(
      [...document.querySelectorAll('.docs-crumbs a')].map((a) => a.getAttribute('href')),
    ).toEqual(['#/docs/quick', '#/docs/quick'])
  })

  // One h1 per view: the page title. The rail's "Docs" title is not a heading.
  it('has one level-1 heading, the page title', async () => {
    render(<Docs page="clone" overview={{}} />)
    await waitFor(() =>
      expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
        'clone',
      ]),
    )
  })

  // DC-19: the reader region is named after the page, not "Page" on every page.
  it('names the reader region after the page title', async () => {
    render(<Docs page="clone" overview={{}} />)
    expect(await screen.findByRole('article', { name: 'From a clone' })).toBeTruthy()
  })

  // The menu places the page, so the menu gives the head its section and its lede: the page
  // payload carries neither.
  it("heads the page with the menu's section and description", async () => {
    render(<Docs page="quick" overview={{}} />)
    await waitFor(() =>
      expect(document.querySelector('.page-head .eyebrow')?.textContent).toBe(
        'Install · 1 min read',
      ),
    )
    expect(document.querySelector('.page-head .sub').textContent).toBe('one command')
  })

  // A 2px bar at the top of the reader shows how far the scroller has gone: `main#main` when
  // it overflows (the app shell), else the document. Decoration only, hidden from the tree.
  it('fills the reading-progress bar as the scroller scrolls', async () => {
    const main = document.createElement('main')
    main.id = 'main'
    document.body.appendChild(main)
    Object.defineProperty(main, 'scrollHeight', { value: 1400, configurable: true })
    Object.defineProperty(main, 'clientHeight', { value: 400, configurable: true })
    try {
      render(<Docs page="quick" overview={{}} />)
      await waitFor(() => expect(document.querySelector('.docs-progress')).toBeTruthy())
      const bar = document.querySelector('.docs-reader > .docs-progress')
      expect(bar.getAttribute('aria-hidden')).toBe('true')
      const fill = () => bar.querySelector('i').style.width
      expect(fill()).toBe('0%')
      main.scrollTop = 250
      act(() => fireEvent.scroll(main))
      expect(fill()).toBe('25%')
      main.scrollTop = 1000
      act(() => fireEvent.scroll(main))
      expect(fill()).toBe('100%')
    } finally {
      main.remove()
    }
  })

  it('narrows the list with the filter and says when nothing matches', async () => {
    render(<Docs page="quick" overview={{}} />)
    await waitFor(() => expect(texts('.lib-rows .lr-name').length).toBe(3))
    fireEvent.change(screen.getByLabelText('Filter Guides'), { target: { value: 'verify' } })
    expect(texts('.lib-rows .lr-name')).toEqual(['Verify it works'])
    expect(texts('.lib-group')).toEqual(['General'])
    fireEvent.change(screen.getByLabelText('Filter Guides'), { target: { value: 'zzz' } })
    expect(screen.getByText('No matches')).toBeTruthy()
  })

  it('offers Previous / Next inside the section only', async () => {
    render(<Docs page="clone" overview={{}} />)
    await waitFor(() => expect(screen.getByText('← Quick start')).toBeTruthy())
    expect(screen.queryByText(/Next:/)).toBeNull()
  })

  it('keeps the Understand track: progress, read marks, and next into the next part', async () => {
    localStorage.setItem('geneseed-understand-seen', '["harness"]')
    render(<Docs page="machine" overview={{}} />)
    await waitFor(() => expect(screen.getByText('Next: Quick start →')).toBeTruthy())
    const bar = document.querySelector('.track-prog')
    expect([bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemax')]).toEqual([
      '2',
      '2',
    ])
    expect([...document.querySelectorAll('.docs-read-mark')].length).toBe(1)
    // "read" is in the row's accessible name, with no visually hidden span: an absolute
    // .sr-only escapes the list's overflow and stretches the document.
    expect(screen.getByRole('link', { name: 'What a harness is, read' })).toBeTruthy()
    expect(document.querySelector('.lib-rows .sr-only')).toBeNull()
    await waitFor(() =>
      expect(localStorage.getItem('geneseed-understand-seen')).toBe('["harness","machine"]'),
    )
  })

  it('opens every page at the top of the scroller', async () => {
    const main = document.createElement('main')
    main.id = 'main'
    document.body.appendChild(main)
    try {
      main.scrollTop = 600
      const { rerender } = render(<Docs page="quick" overview={{}} />)
      expect(main.scrollTop).toBe(0)
      main.scrollTop = 600
      expect(main.scrollTop).toBe(600) // the DOM keeps it, so the reset below is observed
      rerender(<Docs page="clone" overview={{}} />)
      expect(main.scrollTop).toBe(0)
      // Layouts where the document itself scrolls are reset too.
      const doc = document.scrollingElement || document.documentElement
      doc.scrollTop = 400
      expect(doc.scrollTop).toBe(400)
      rerender(<Docs page="verify" overview={{}} />)
      expect(doc.scrollTop).toBe(0)
    } finally {
      main.remove()
    }
  })
})
