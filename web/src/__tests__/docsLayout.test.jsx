import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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
