import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../api.js', () => ({
  api: {
    graph: () => Promise.resolve({
      nodes: [
        { id: 'scribe', type: 'agent' },
        { id: 'git', type: 'skill' },
        { id: 'loner', type: 'skill' },
      ],
      edges: [{ source: 'scribe', target: 'git' }],
    }),
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
