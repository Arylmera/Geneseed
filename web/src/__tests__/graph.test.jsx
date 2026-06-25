import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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
  it('opens in Matrix view: shows the citing/cited nodes and the readout', async () => {
    render(<Graph />)
    // Matrix rows = citers (scribe → out-edge), columns = cited (git → in-edge).
    await waitFor(() => expect(screen.getByText('scribe')).toBeTruthy())
    expect(screen.getByText('git')).toBeTruthy()
    // `loner` has no edges, so it has neither a row nor a column in the matrix.
    expect(screen.queryByText('loner')).toBeNull()
    expect(screen.getByText(/3 nodes · 1 links shown/)).toBeTruthy()
  })

  it('Network view lists every node, including unlinked ones', async () => {
    render(<Graph />)
    await waitFor(() => expect(screen.getByText('scribe')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Network' }))
    expect(screen.getByText('loner')).toBeTruthy()
    expect(screen.getByText('git')).toBeTruthy()
  })
})
