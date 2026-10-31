import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../api/index.js', () => ({ api: { installs: vi.fn() } }))

import Tabs from '../components/Tabs.jsx'
import Installs from '../pages/Installs/index.jsx'
import { api } from '../api/index.js'

// A tab badge is a plain figure, or `{ v, of }` when the figure is one install's among several:
// the badge then names that install, in a tooltip and for a screen reader.
describe('Tabs badges', () => {
  it('a plain badge is its figure alone', () => {
    render(<Tabs page="installs" current="hosts" badges={{ edits: 3 }} label="Installs" />)
    const b = screen.getByRole('link', { name: /^Local edits/ }).querySelector('.tab-badge')
    expect([b.textContent, b.getAttribute('title')]).toEqual(['3', null])
  })

  it('a named badge says whose figure it is', () => {
    render(
      <Tabs
        page="installs"
        current="hosts"
        badges={{ doctor: { v: 'clean', of: 'claude · global' } }}
        label="Installs"
      />,
    )
    const b = screen.getByRole('link', { name: /^Doctor/ }).querySelector('.tab-badge')
    expect([b.textContent, b.getAttribute('title')]).toEqual([
      'clean for claude · global',
      'for claude · global',
    ])
  })
})

// The Installs page's Doctor and Local edits badges come from the default install's overview:
// with two active installs they name it, since each tab reads its own pick.
describe('Installs tab badges', () => {
  afterEach(() => api.installs.mockReset())
  it('name the default install once two are active', async () => {
    api.installs.mockResolvedValue({
      installs: [
        { id: 'cl', host: 'claude', scope: 'global', path: '/cl', state: 'active', default: true },
        { id: 'oc', host: 'opencode', scope: 'global', path: '/oc', state: 'active' },
      ],
    })
    render(
      <Installs
        tab="kits-none"
        overview={{ doctor: { ok: true, problems: [] }, diff: { edited: 1, added: 0, missing: 0 } }}
      />,
    )
    const badge = () => screen.getByRole('link', { name: /^Doctor/ }).querySelector('.tab-badge')
    await waitFor(() => expect(badge().getAttribute('title')).toBe('for claude · global'))
  })
})
