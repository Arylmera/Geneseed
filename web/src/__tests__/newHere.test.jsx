import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api/index.js', () => ({ api: { docs: vi.fn() } }))

import { NewHere } from '../pages/Overview/index.jsx'
import { api } from '../api/index.js'

// The Overview's "New here?" card: progress over the understand pages read so far, a
// button to the first unread one ("Start" before any is read, "Continue · step N" after),
// and a × that hides it for good. Every page read hides it too.
const PAGES = ['harness', 'machine', 'day', 'enforced'].map((id) => ({ id, title: id }))
const SEEN = 'geneseed-understand-seen'
const DISMISSED = 'geneseed-newhere-dismissed'

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  api.docs.mockResolvedValue({
    groups: [
      { id: 'understand', label: 'Understand', pages: PAGES },
      { id: 'guides', label: 'Guides', pages: [{ id: 'install', title: 'Install' }] },
    ],
  })
})

const dots = (c) => [...c.querySelectorAll('.newhere-dots i')].map((i) => i.className)

describe('NewHere', () => {
  it('starts at step 1 when nothing is read', async () => {
    render(<NewHere harness="claude" />)
    const btn = await screen.findByText('Start')
    expect(btn.getAttribute('href')).toBe('#/docs/harness')
    expect(api.docs).toHaveBeenCalledWith('claude')
  })

  it('continues at the first unread page, with progress', async () => {
    localStorage.setItem(SEEN, JSON.stringify(['harness', 'machine']))
    const { container } = render(<NewHere harness="claude" />)
    const btn = await screen.findByText('Continue · step 3')
    expect(btn.getAttribute('href')).toBe('#/docs/day')
    expect(dots(container)).toEqual(['f', 'f', '', ''])
  })

  it('dismisses for good', async () => {
    const { container } = render(<NewHere harness="claude" />)
    fireEvent.click(await screen.findByLabelText('Dismiss'))
    expect(localStorage.getItem(DISMISSED)).toBe('1')
    expect(container.innerHTML).toBe('')
  })

  it('stays hidden once dismissed, without fetching', () => {
    localStorage.setItem(DISMISSED, '1')
    const { container } = render(<NewHere harness="claude" />)
    expect(container.innerHTML).toBe('')
    expect(api.docs).not.toHaveBeenCalled()
  })

  it('hides once every understand page is read', async () => {
    localStorage.setItem(SEEN, JSON.stringify(PAGES.map((p) => p.id)))
    const { container } = render(<NewHere harness="claude" />)
    await waitFor(() => expect(api.docs).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(container.innerHTML).toBe('')
  })
})
