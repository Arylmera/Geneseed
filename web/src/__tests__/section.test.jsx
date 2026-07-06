import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The Section page was retired when Library absorbed it into one chip-bar
// page. These tests target the new Library component, asserting the same
// behaviours used to live on Section: list a section's catalog, drill into an
// item via the URL, forget a memory fact.
vi.mock('../api/index.js', () => ({
  api: { catalog: vi.fn(), item: vi.fn(), memoryDelete: vi.fn() },
}))

import Library from '../pages/Library.jsx'
import { api } from '../api/index.js'

const overview = (counts) => ({ counts })

// Distinct rows per section so a leaked row betrays which section it came from.
const SECTION_ITEMS = {
  agents: [
    { name: 'reviewer', title: 'Reviewer', desc: 'reviews code' },
    { name: 'tester', title: 'Tester', desc: 'writes tests' },
  ],
  skills: [{ name: 'brainstorm', title: 'Brainstorm', desc: 'generates ideas' }],
}

// Fresh, well-behaved defaults before each test; individual tests override
// api.catalog to script slower/in-flight responses.
beforeEach(() => {
  api.catalog.mockImplementation((section) =>
    Promise.resolve({ section, items: SECTION_ITEMS[section] || SECTION_ITEMS.agents }),
  )
  api.item.mockImplementation(() =>
    Promise.resolve({ title: 'A fact', desc: '', body: 'body', links: [] }),
  )
  api.memoryDelete.mockImplementation(() => Promise.resolve({ deleted: 'fact-a' }))
})
afterEach(() => vi.clearAllMocks())

describe('Library chip-bar (replaces Section)', () => {
  it('renders agents standalone: no chip-bar, Agents title, catalog listed', async () => {
    render(<Library section="agents" overview={overview({ agents: 2, skills: 5 })} />)
    // wait for the catalog to land (one row per item, plus auto-selected
    // detail header echoing the first item — hence getAllByText for "Reviewer")
    await waitFor(() => expect(screen.getAllByText('Reviewer').length).toBeGreaterThan(0))
    expect(screen.getByText('Tester')).toBeTruthy()
    // agents has its own top-level tab (#/agents) like Laws and Skills, so the
    // Library chip-bar is hidden and the page is titled after the section
    expect(document.querySelector('.lib-secbar')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Agents')
  })

  it('keeps the chip-bar for library sections, without an Agents chip', async () => {
    render(<Library section="memory" overview={overview({ agents: 2, memory: 3 })} />)
    await waitFor(() => expect(document.querySelector('.lib-secbar')).toBeTruthy())
    const chips = [...document.querySelectorAll('.lib-secchip')].map((b) => b.textContent)
    expect(chips.some((t) => t.includes('Memory'))).toBe(true)
    expect(chips.some((t) => t.includes('Agents'))).toBe(false)
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

  it('hides the prior section and skips a cross-type fetch while the next catalog loads', async () => {
    // Hold the skills catalog in flight so we can observe the switch window.
    let releaseSkills
    api.catalog.mockImplementation((section) => {
      if (section === 'skills') {
        return new Promise((resolve) => {
          releaseSkills = () => resolve({ section: 'skills', items: SECTION_ITEMS.skills })
        })
      }
      return Promise.resolve({ section, items: SECTION_ITEMS[section] })
    })

    const { rerender } = render(<Library section="agents" overview={overview({})} />)
    await waitFor(() => expect(screen.getByText('Tester')).toBeTruthy())

    // Switch to skills; its catalog has not resolved yet. useAsync still holds
    // the agents catalog in `data`, so without the section guard the old rows
    // would linger and the first one would be fetched under the skill type.
    rerender(<Library section="skills" overview={overview({})} />)
    await waitFor(() => expect(screen.queryByText('Tester')).toBeNull())
    expect(screen.queryByText('Reviewer')).toBeNull()
    expect(api.item).not.toHaveBeenCalledWith('skill', 'reviewer')
    expect(api.item).not.toHaveBeenCalledWith('skill', 'tester')

    // Once skills lands, its own rows appear.
    releaseSkills()
    await waitFor(() => expect(screen.getByText('Brainstorm')).toBeTruthy())
  })
})
