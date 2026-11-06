import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../api/index.js', () => ({ api: { installs: vi.fn() } }))

import Tabs from '../components/Tabs.jsx'
import Installs from '../pages/Installs/index.jsx'

// A tab badge is a plain figure.
describe('Tabs badges', () => {
  it('a plain badge is its figure alone', () => {
    render(<Tabs page="installs" current="hosts" badges={{ edits: 3 }} label="Installs" />)
    const b = screen.getByRole('link', { name: /^Local edits/ }).querySelector('.tab-badge')
    expect([b.textContent, b.getAttribute('title')]).toEqual(['3', null])
  })
})

// Each Installs tab reads its own picked install, so no one install's figure stands on a tab.
describe('Installs tabs', () => {
  it('carry no badge, even with drift and doctor problems on the overview', () => {
    render(
      <Installs
        tab="kits-none"
        overview={{
          doctor: { ok: false, problems: ['x'] },
          diff: { edited: 1, added: 0, missing: 0 },
        }}
      />,
    )
    expect(document.querySelector('.tab-badge')).toBeNull()
  })
})
