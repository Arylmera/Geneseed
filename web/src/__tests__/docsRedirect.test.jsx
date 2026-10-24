import React from 'react'
import { render, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// A page the chosen harness hides is sent back to the first page — by REPLACING the history
// entry. Pushing a new one is a Back trap: Back returns to the hidden page, which redirects
// forward again. The real router runs here (no mock), so the history is jsdom's own.
vi.mock('../api/index.js', () => ({ api: { docs: vi.fn(), docsPage: vi.fn() } }))

import Docs from '../pages/Docs/index.jsx'
import { api } from '../api/index.js'

const MENU = {
  harness: 'opencode',
  groups: [
    {
      id: 'understand',
      label: 'Understand',
      pages: [{ id: 'harness', title: 'What a harness is', kind: 'concept' }],
    },
  ],
}

beforeEach(() => {
  api.docs.mockResolvedValue(MENU)
  api.docsPage.mockImplementation((id) =>
    Promise.resolve({ id, kind: 'concept', title: id, body: 'text' }),
  )
})

describe('Docs redirect', () => {
  it('replaces the entry of a hidden page instead of pushing one', async () => {
    window.location.hash = '#/docs/hidden'
    const before = window.history.length
    render(<Docs page="hidden" overview={{}} />)
    await waitFor(() => expect(window.location.hash).toBe('#/docs/harness'))
    expect(window.history.length).toBe(before)
  })
})
