import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The section chip row above a part's list (ClassChips, shared with the Library's skill
// classes): "All" plus one chip per section with its page count, narrowing the list to one
// section. Markup/classes/ARIA come from components/ClassChips.jsx; see library.test.jsx
// for the Library side of the same component.
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
  [...document.querySelectorAll('.skill-cat')].map((b) => b.textContent.replace(/\s+/g, ' '))

describe('Docs section chips', () => {
  it('shows All and each section of the part, with their counts', async () => {
    render(<Docs page="clone" overview={{}} />)
    await waitFor(() => expect(texts('.lib-rows .lr-name').length).toBe(3))
    expect(chipNames()).toEqual(['All 3', 'Install 2', 'General 1'])
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
