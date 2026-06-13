import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../api/index.js', () => ({
  api: {
    setup: () => Promise.resolve({
      installed_fp: 'a3f1c9e2', source_fp: 'a3f1c9e2',
      version_verdict: 'up to date (0.1.0)',
    }),
    jobs: () => Promise.resolve({
      jobs: [{ id: 'j1', action: 'doctor', status: 'done', output: '', duration: 4,
        started: Date.now() / 1000 - 120 }],
    }),
    graph: () => Promise.resolve({ nodes: [], edges: [] }),
  },
}))

import Dashboard from '../pages/Dashboard/index.jsx'

const overview = {
  deployed: true, theme: 'imperial', accent: 'yellow', emit: 'opencode-global',
  target: '/home/u/.config/opencode', build_time: '2026-06-12 09:41',
  doctor: { ok: false, problems: ['1 dead cross-link'], checked_at: '2026-06-12' },
  diff: { edited: 3, added: 1, missing: 0 },
  counts: { agents: 16, skills: 25, laws: 20, memory: 41, notebook: 6, wiki: 128, config: 4 },
}
const themes = [{ name: 'imperial', accent: 'yellow', tagline: '', sigil: 'The Codex in force.', blurb: '' }]

describe('Dashboard', () => {
  it('renders the status direction with ring, KPIs, and genome counts', async () => {
    render(<Dashboard overview={overview} themes={themes} onAction={() => {}} />)
    await waitFor(() => expect(screen.getByText('germination')).toBeTruthy())
    expect(screen.getByText('The Codex in force')).toBeTruthy()        // headline
    expect(screen.getByText('The Codex in force.')).toBeTruthy()       // sigil (trailing period)
    expect(screen.getAllByText('16').length).toBeGreaterThan(0)        // agents KPI + genome
    expect(screen.getByText('128')).toBeTruthy()                       // wiki genome cell
    // readiness: .40 + .15 (1 problem) + .20 (fp match) + .15 (no missing) = 90%
    expect(screen.getByText('90')).toBeTruthy()
  })

  it('switches directions via the segmented control', async () => {
    render(<Dashboard overview={overview} themes={themes} onAction={() => {}} />)
    fireEvent.click(screen.getByText('Lineage'))
    await waitFor(() => expect(screen.getByText('Gene-seed lineage')).toBeTruthy())
    fireEvent.click(screen.getByText('Operator'))
    await waitFor(() => expect(screen.getByText(/entries total/)).toBeTruthy())
  })

  it('shows a loading state without overview', () => {
    render(<Dashboard overview={null} themes={[]} onAction={() => {}} />)
    expect(screen.getByText(/Loading/)).toBeTruthy()
  })
})
