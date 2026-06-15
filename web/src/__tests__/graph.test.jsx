import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../api/index.js', () => ({
  api: {
    graph: () =>
      Promise.resolve({
        nodes: [
          { id: 'scribe', type: 'agent' },
          { id: 'git', type: 'skill' },
          { id: 'loner', type: 'skill' },
        ],
        edges: [{ source: 'scribe', target: 'git' }],
      }),
    // Graph now reads law titles from the laws catalog so it can label nodes
    // as "Rule III — Verify…" rather than the bare Roman numeral. Returns
    // empty here since this fixture has no law nodes.
    catalog: () => Promise.resolve({ items: [] }),
  },
}))

import Graph from '../pages/Graph.jsx'

describe('Graph', () => {
  it('renders every node label and counts links', async () => {
    render(<Graph />)
    await waitFor(() => expect(screen.getByText('scribe')).toBeTruthy())
    expect(screen.getByText('git')).toBeTruthy()
    expect(screen.getByText('loner')).toBeTruthy()
    expect(screen.getByText(/3 nodes · 1 links/)).toBeTruthy()
  })
})
