import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The Library: kinds column, list pane, reader. Skills and Agents used to be pages of their
// own and are now its first two kinds, so what those pages pinned (list a catalog, open an
// entry from the URL, the lifecycle badges) is pinned here, beside what the Library always
// did (forget a memory fact, never fetch across kinds).
vi.mock('../api/index.js', () => ({
  api: { catalog: vi.fn(), item: vi.fn(), memoryDelete: vi.fn() },
}))

// Every confirm answers yes (hooks/useConfirm.jsx; its own dialog is tested elsewhere).
const { askConfirm } = vi.hoisted(() => ({ askConfirm: vi.fn(async () => true) }))
vi.mock('../hooks/useConfirm.jsx', () => ({ useConfirm: () => askConfirm }))

import Library, { splitSkills } from '../pages/Library.jsx'
import { api } from '../api/index.js'

const overview = (counts) => ({ counts })

// Distinct rows per kind so a leaked row betrays which kind it came from.
const SECTION_ITEMS = {
  agents: [
    { name: 'reviewer', title: 'Reviewer', desc: 'reviews code' },
    { name: 'tester', title: 'Tester', desc: 'writes tests' },
  ],
  skills: [
    { name: 'brainstorm', title: 'Brainstorm', desc: 'ideas', klass: 'design', status: 'approved' },
    { name: 'rule', title: 'rule', desc: 'front door', klass: 'design', status: 'experimental' },
  ],
  memory: [{ name: 'fact-a', title: 'fact-a', desc: '' }],
}

beforeEach(() => {
  api.catalog.mockImplementation((section) =>
    Promise.resolve({ section, items: SECTION_ITEMS[section] || [] }),
  )
  api.item.mockImplementation(() =>
    Promise.resolve({ title: 'A fact', desc: '', body: 'body', links: [] }),
  )
  api.memoryDelete.mockImplementation(() => Promise.resolve({ deleted: 'fact-a' }))
})
afterEach(() => vi.clearAllMocks())

const kinds = () =>
  [...document.querySelectorAll('.kind-list a')].map((a) => [
    a.firstChild.textContent,
    a.querySelector('.mono').textContent,
    a.getAttribute('aria-current'),
  ])

describe('Library', () => {
  it('lists every kind with its count, the routed one current', async () => {
    render(
      <Library
        section="agents"
        overview={overview({ skills: 52, agents: 18, memory: 2, notebook: 2, wiki: 0, config: 2 })}
      />,
    )
    await waitFor(() => expect(screen.getAllByText('Reviewer').length).toBeGreaterThan(0))
    expect(kinds()).toEqual([
      ['Skills', '52', null],
      ['Agents', '18', 'page'],
      ['Memory', '2', null],
      ['Notebook', '2', null],
      ['Wiki', '0', null],
      ['Setup files', '2', null],
    ])
  })

  it('opens on skills when #/library carries no kind, and lists them', async () => {
    render(<Library overview={overview({})} />)
    await waitFor(() => expect(screen.getAllByText('Brainstorm').length).toBeGreaterThan(0))
    expect(api.catalog).toHaveBeenCalledWith('skills')
  })

  // The lifecycle badge shows only where a skill deviates: approved renders nothing.
  it('badges only the non-approved skills', async () => {
    render(<Library section="skills" overview={overview({})} />)
    await waitFor(() => expect(screen.getAllByText('Brainstorm').length).toBeGreaterThan(0))
    expect(document.querySelectorAll('.lib-rows .badge')).toHaveLength(1)
    expect(document.querySelector('.lib-rows .badge').textContent).toContain('experimental')
  })

  it('auto-selects the first entry, and each row links to its own address', async () => {
    render(<Library section="agents" overview={overview({})} />)
    await waitFor(() => expect(screen.getAllByText('Reviewer').length).toBeGreaterThan(1))
    expect([...document.querySelectorAll('a.lib-row')].map((a) => a.getAttribute('href'))).toEqual([
      '#/item/agent/reviewer',
      '#/item/agent/tester',
    ])
    expect(document.querySelector('a.lib-row.on').getAttribute('href')).toBe(
      '#/item/agent/reviewer',
    )
  })

  it('forgets a memory fact via the delete control', async () => {
    render(<Library section="memory" selected="fact-a" overview={overview({})} />)
    fireEvent.click(await screen.findByText('Forget this fact'))
    await waitFor(() => expect(api.memoryDelete).toHaveBeenCalledWith('fact-a'))
  })

  it('says why a forget failed instead of swallowing it', async () => {
    api.memoryDelete.mockRejectedValueOnce(new Error('store is read-only'))
    render(<Library section="memory" selected="fact-a" overview={overview({})} />)
    fireEvent.click(await screen.findByText('Forget this fact'))
    expect(await screen.findByText(/Could not forget "fact-a": store is read-only/)).toBeTruthy()
  })

  it('shows no forget control outside memory', async () => {
    render(<Library section="agents" selected="reviewer" overview={overview({})} />)
    await waitFor(() => expect(screen.getByText('A fact')).toBeTruthy())
    expect(screen.queryByText('Forget this fact')).toBeNull()
  })

  // Personal's Memory tab: one kind, no kinds column, and entries addressed under the tab
  // so opening one stays on the Personal page.
  it('locked to one kind, drops the kinds column and links under its base', async () => {
    render(<Library lock="memory" base="#/personal/memory" overview={overview({})} />)
    await waitFor(() => expect(document.querySelector('a.lib-row')).toBeTruthy())
    expect(document.querySelector('.lib-kinds')).toBeNull()
    expect(document.querySelector('a.lib-row').getAttribute('href')).toBe(
      '#/personal/memory/fact-a',
    )
  })

  it('hides the prior kind and skips a cross-type fetch while the next catalog loads', async () => {
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

    // useAsync still holds the agents catalog while skills is in flight; without the
    // section guard the old rows would linger and be fetched under the skill type.
    rerender(<Library section="skills" overview={overview({})} />)
    await waitFor(() => expect(screen.queryByText('Tester')).toBeNull())
    expect(screen.queryByText('Reviewer')).toBeNull()
    expect(api.item).not.toHaveBeenCalledWith('skill', 'reviewer')
    expect(api.item).not.toHaveBeenCalledWith('skill', 'tester')

    releaseSkills()
    await waitFor(() => expect(screen.getAllByText('Brainstorm').length).toBeGreaterThan(0))
  })
})

// Skills are divided by class, as the old Skills page was: listed class by class in the
// SKILL_CATS order under a header, with a chip per class present. A klass the registry does
// not know lands in `personal`, outside the taxonomy.
describe('skill classes', () => {
  const SKILLS = [
    { name: 'commit', klass: 'ship' },
    { name: 'debug', klass: 'build' },
    { name: 'brainstorm', klass: 'design' },
    { name: 'develop', klass: 'build' },
    { name: 'mine', klass: 'no-such-class' },
  ]

  it('orders skills by class and counts each class present', () => {
    const { rows, cats } = splitSkills(SKILLS)
    expect(rows.map((r) => [r.name, r.group])).toEqual([
      ['brainstorm', 'Design'],
      ['debug', 'Build'],
      ['develop', 'Build'],
      ['commit', 'Ship'],
      ['mine', 'Personal'],
    ])
    expect(cats.map((c) => [c.key, c.n])).toEqual([
      ['design', 1],
      ['build', 2],
      ['ship', 1],
      ['personal', 1],
    ])
  })

  it('heads the list by class and narrows to one class with its chip', async () => {
    api.catalog.mockImplementation((section) =>
      Promise.resolve({ section, items: section === 'skills' ? SKILLS : [] }),
    )
    render(<Library section="skills" overview={overview({ skills: 5 })} />)
    await waitFor(() => expect(document.querySelector('.skill-cats')).toBeTruthy())
    expect([...document.querySelectorAll('.lib-group')].map((g) => g.textContent)).toEqual([
      'Design',
      'Build',
      'Ship',
      'Personal',
    ])
    fireEvent.click(screen.getByRole('button', { name: /^Build/ }))
    expect([...document.querySelectorAll('.lib-row')].length).toBe(2)
    expect([...document.querySelectorAll('.lib-group')].map((g) => g.textContent)).toEqual([
      'Build',
    ])
    fireEvent.click(screen.getByRole('button', { name: /^All/ }))
    expect([...document.querySelectorAll('.lib-row')].length).toBe(5)
  })
})
