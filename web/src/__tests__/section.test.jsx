import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// The Section page was retired when Library absorbed it into one chip-bar
// page. These tests target the new Library component, asserting the same
// behaviours used to live on Section: list a section's catalog, drill into an
// item via the URL, forget a memory fact.
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

import Library from '../pages/Library.jsx'
import { api } from '../api/index.js'

const overview = (counts) => ({ counts })

describe('Library chip-bar (replaces Section)', () => {
  it('shows the active section chip and lists the catalog items', async () => {
    render(<Library section="agents" overview={overview({ agents: 2, skills: 5 })} />)
    // wait for the catalog to land (one row per item, plus auto-selected
    // detail header echoing the first item — hence getAllByText for "Reviewer")
    await waitFor(() => expect(screen.getAllByText('Reviewer').length).toBeGreaterThan(0))
    expect(screen.getByText('Tester')).toBeTruthy()
    // the Agents chip is the on-state in the chip bar
    const agentsChip = screen.getAllByText('Agents').find((el) =>
      el.closest('button')?.className.includes('lib-secchip'),
    )
    expect(agentsChip.closest('button').className).toContain('on')
    // its count chip reads "2" — the agents value passed in via overview
    const chipBtn = agentsChip.closest('button')
    expect(chipBtn.textContent).toContain('2')
  })

  it('auto-selects the first item when none is in the URL', async () => {
    render(<Library section="agents" overview={overview({})} />)
    // Reviewer appears in both the list row AND the detail pane header
    await waitFor(() => expect(screen.getAllByText('Reviewer').length).toBeGreaterThan(1))
  })

  it('forgets a memory fact via the delete control', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Library section="memory" selected="fact-a" overview={overview({})} />)
    await waitFor(() => expect(screen.getByText('Forget this fact')).toBeTruthy())
    fireEvent.click(screen.getByText('Forget this fact'))
    await waitFor(() => expect(api.memoryDelete).toHaveBeenCalledWith('fact-a'))
  })

  it('shows no forget control for non-memory sections', async () => {
    render(<Library section="agents" selected="reviewer" overview={overview({})} />)
    await waitFor(() => expect(screen.getByText('A fact')).toBeTruthy())
    expect(screen.queryByText('Forget this fact')).toBeNull()
  })
})
