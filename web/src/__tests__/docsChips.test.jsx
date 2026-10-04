import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The open part's sections, nested under it in the rail (RailCats, shared with the Library's
// skill classes): "All" plus one row per section with its page count, narrowing the list to
// one section. Only the open part carries them; a part of one section carries none.
// Markup/classes/ARIA come from components/RailCats.jsx; see library.test.jsx for the
// Library side of the same component.
vi.mock('../api/index.js', () => ({ api: { docs: vi.fn(), docsPage: vi.fn() } }))
vi.mock('../lib/router.js', () => ({ go: vi.fn() }))

import Docs from '../pages/Docs/index.jsx'
import { api } from '../api/index.js'

const MENU = {
  harness: 'opencode',
  groups: [
    {
      id: 'guides',
      label: 'Guides',
      pages: [
        { id: 'quick', title: 'Quick start', kind: 'concept', section: 'Install' },
        { id: 'clone', title: 'From a clone', kind: 'concept', section: 'Install' },
        { id: 'verify', title: 'Verify it works', kind: 'concept', section: 'General' },
      ],
    },
    {
      id: 'concepts',
      label: 'Concepts',
      pages: [
        { id: 'a', title: 'A thing', kind: 'concept', section: 'Core' },
        { id: 'b', title: 'B thing', kind: 'concept', section: 'Core' },
        { id: 'c', title: 'C thing', kind: 'concept', section: 'Advanced' },
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
const chipNames = () =>
  [...document.querySelectorAll('.rail-cats button')].map((b) =>
    [...b.querySelectorAll('span:not(.cdot)')].map((x) => x.textContent).join(' '),
  )

describe('Docs sections in the rail', () => {
  it('shows All and each section of the part, with their counts', async () => {
    render(<Docs page="clone" overview={{}} />)
    await waitFor(() => expect(texts('.lib-rows .lr-name').length).toBe(3))
    expect(chipNames()).toEqual(['All 3', 'Install 2', 'General 1'])
  })

  it('nests them under the open part only, after its link in Tab order', async () => {
    render(<Docs page="clone" overview={{}} />)
    await waitFor(() => expect(texts('.lib-rows .lr-name').length).toBe(3))
    const nav = screen.getByRole('navigation', { name: 'Parts' })
    expect(nav.querySelectorAll('.rail-cats').length).toBe(1)
    const list = screen.getByRole('list', { name: 'Sections' })
    // The tab stops in document order: Guides, its three sections, then Concepts.
    const stops = [...nav.querySelectorAll('a, button')].map((n) =>
      n.tagName === 'A' ? n.firstChild.textContent : n.querySelector('.rc-name').textContent,
    )
    expect(stops).toEqual(['Guides', 'All', 'Install', 'General', 'Concepts'])
    expect(nav.querySelector('a[aria-current="page"]').nextElementSibling).toBe(list.parentElement)
  })

  it('shows none for a part of a single section', async () => {
    api.docs.mockResolvedValue({
      ...MENU,
      groups: [
        MENU.groups[0],
        {
          id: 'ref',
          label: 'Reference',
          pages: [{ id: 'r', title: 'R', kind: 'concept', section: 'Only' }],
        },
      ],
    })
    render(<Docs page="r" overview={{}} />)
    await waitFor(() => expect(texts('.lib-rows .lr-name')).toEqual(['R']))
    expect(document.querySelector('.rail-cats')).toBeNull()
  })

  it('sizes the share bar by each section page count', async () => {
    render(<Docs page="clone" overview={{}} />)
    await waitFor(() => expect(texts('.lib-rows .lr-name').length).toBe(3))
    const segs = [...document.querySelectorAll('.rail-mix span')]
    expect(segs.map((s) => s.style.flexGrow)).toEqual(['2', '1'])
  })

  it('narrows the list to the clicked section', async () => {
    render(<Docs page="clone" overview={{}} />)
    await waitFor(() => expect(texts('.lib-rows .lr-name').length).toBe(3))
    fireEvent.click(screen.getByRole('button', { name: /^Install/ }))
    expect(texts('.lib-rows .lr-name')).toEqual(['Quick start', 'From a clone'])
    expect(texts('.lib-group')).toEqual(['Install'])
    fireEvent.click(screen.getByRole('button', { name: /^All/ }))
    expect(texts('.lib-rows .lr-name').length).toBe(3)
  })

  it('combines the chip with the filter box', async () => {
    render(<Docs page="clone" overview={{}} />)
    await waitFor(() => expect(texts('.lib-rows .lr-name').length).toBe(3))
    fireEvent.click(screen.getByRole('button', { name: /^Install/ }))
    fireEvent.change(screen.getByLabelText('Filter Guides'), { target: { value: 'clone' } })
    expect(texts('.lib-rows .lr-name')).toEqual(['From a clone'])
  })

  it('resets to All when the part changes', async () => {
    const { rerender } = render(<Docs page="clone" overview={{}} />)
    await waitFor(() => expect(texts('.lib-rows .lr-name').length).toBe(3))
    fireEvent.click(screen.getByRole('button', { name: /^Install/ }))
    expect(texts('.lib-rows .lr-name').length).toBe(2)

    rerender(<Docs page="a" overview={{}} />)
    await waitFor(() => expect(texts('.lib-rows .lr-name').length).toBe(3))
    expect(chipNames()).toEqual(['All 3', 'Core 2', 'Advanced 1'])
    expect(screen.getByRole('button', { name: /^All/ }).getAttribute('aria-pressed')).toBe('true')
  })
})

// The host selector names the four hosts (lib/hosts.js), defaults to the deployed install's
// own host, and a stored choice from the two-family selector is still honoured.
describe('Docs host selector', () => {
  const hostButtons = () => [...document.querySelectorAll('.lib-kinds .seg button')]
  const pressed = () => hostButtons().find((b) => b.getAttribute('aria-pressed') === 'true')

  it('lists the four hosts', async () => {
    render(<Docs page="clone" overview={{}} />)
    await waitFor(() => expect(texts('.lib-rows .lr-name').length).toBe(3))
    expect(hostButtons().map((b) => b.textContent)).toEqual([
      'OpenCode',
      'Claude Code',
      'BOB (IBM)',
      'OpenClaude',
    ])
  })

  it.each([
    ['bob-global', 'BOB (IBM)', 'bob'],
    ['openclaude', 'OpenClaude', 'openclaude'],
    ['claude-global', 'Claude Code', 'claude'],
    ['files', 'OpenCode', 'opencode'],
  ])('an install emitted as %s opens on %s', async (emit, label, host) => {
    render(<Docs page="clone" overview={{ emit }} />)
    await waitFor(() => expect(texts('.lib-rows .lr-name').length).toBe(3))
    expect(pressed().textContent).toBe(label)
    expect(api.docs).toHaveBeenCalledWith(host)
  })

  it('keeps a choice stored by the old two-family selector', async () => {
    localStorage.setItem('geneseed-harness', 'claude')
    render(<Docs page="clone" overview={{ emit: 'bob' }} />)
    await waitFor(() => expect(texts('.lib-rows .lr-name').length).toBe(3))
    expect(pressed().textContent).toBe('Claude Code')
  })

  it('asks the server for the chosen host', async () => {
    render(<Docs page="clone" overview={{}} />)
    await waitFor(() => expect(texts('.lib-rows .lr-name').length).toBe(3))
    fireEvent.click(screen.getByRole('button', { name: 'OpenClaude' }))
    await waitFor(() => expect(api.docs).toHaveBeenCalledWith('openclaude'))
  })
})
