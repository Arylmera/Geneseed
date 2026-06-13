import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../api/index.js', () => ({
  api: {
    catalog: () =>
      Promise.resolve({
        items: [
          { name: 'reviewer', title: 'Reviewer', desc: 'reviews code' },
          { name: 'tester', title: 'Tester', desc: 'writes tests' },
        ],
      }),
    item: () => Promise.resolve({ title: 'A fact', desc: '', body: 'body', links: [] }),
    memoryDelete: vi.fn(() => Promise.resolve({ deleted: 'fact-a' })),
  },
}))

import Section from '../pages/Section.jsx'
import { api } from '../api/index.js'

describe('Section', () => {
  it('labels the active section with its count and lists the catalog items', async () => {
    render(<Section section="agents" counts={{ agents: 2, skills: 5 }} />)
    await waitFor(() => expect(screen.getByText('Reviewer')).toBeTruthy())
    expect(screen.getByText('Tester')).toBeTruthy()
    // the list pane heads with the active section (sibling sections now live in
    // the rail sub-menu, not an in-page tab strip)
    expect(screen.getByText('Agents')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.queryByText('Skills')).toBeNull()
  })

  it('filters the list by the search query', async () => {
    render(<Section section="agents" query="test" counts={{}} />)
    await waitFor(() => expect(screen.getByText('Tester')).toBeTruthy())
    expect(screen.queryByText('Reviewer')).toBeNull()
  })

  it('prompts to pick an item when nothing is selected', async () => {
    render(<Section section="agents" counts={{}} />)
    await waitFor(() => expect(screen.getByText('Select an item')).toBeTruthy())
  })

  it('forgets a memory fact via the delete control', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Section section="memory" selected="fact-a" counts={{}} />)
    await waitFor(() => expect(screen.getByText('Forget this fact')).toBeTruthy())
    fireEvent.click(screen.getByText('Forget this fact'))
    await waitFor(() => expect(api.memoryDelete).toHaveBeenCalledWith('fact-a'))
  })

  it('shows no forget control for non-memory sections', async () => {
    render(<Section section="agents" selected="reviewer" counts={{}} />)
    await waitFor(() => expect(screen.getByText('A fact')).toBeTruthy())
    expect(screen.queryByText('Forget this fact')).toBeNull()
  })
})
