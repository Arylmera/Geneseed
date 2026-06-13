import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
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
    item: () => Promise.resolve(null),
  },
}))

import Section from '../pages/Section.jsx'

describe('Section', () => {
  it('renders the tab strip with counts and the catalog items', async () => {
    render(<Section section="agents" counts={{ agents: 2, skills: 5 }} />)
    await waitFor(() => expect(screen.getByText('Reviewer')).toBeTruthy())
    expect(screen.getByText('Tester')).toBeTruthy()
    // tab strip is driven by the shared sections taxonomy
    expect(screen.getByText('Agents')).toBeTruthy()
    expect(screen.getByText('Skills')).toBeTruthy()
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
})
