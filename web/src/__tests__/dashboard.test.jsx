import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// `setup` and job history (`runs`) are no longer fetched here: App owns the one copy of
// each (the rail's germination ring reads the same two setup fingerprints, and the
// console owns the one job poll) and hands both down as props, so the mock lost its
// `setup` and `jobs` arms — every render below passes a `runs` snapshot instead. Every
// lens shows the fleet verdict, so `fleet` answers: a healthy fleet by default (one
// synced install, doctor clean, no drift), which keeps the voice headline speaking.
const fleet = vi.hoisted(() => ({ current: null }))
const doctor = vi.hoisted(() => ({ current: null }))
vi.mock('../api/index.js', () => ({
  api: {
    fleet: () =>
      fleet.current instanceof Error
        ? Promise.reject(fleet.current)
        : Promise.resolve(fleet.current),
    doctor: () => doctor.current(),
  },
}))
const GOOD_FLEET = {
  doctor: { ok: true, problems: [] },
  installs: [{ id: 'cl', state: 'active', verdict: 'synced', drift: null }],
}
beforeEach(() => {
  fleet.current = GOOD_FLEET
  // By default a doctor that never answers: the Greenhouse lens must say so, not
  // "loading" forever.
  doctor.current = () => Promise.reject(new Error(''))
})

import Dashboard from '../pages/Dashboard/index.jsx'

const overview = {
  deployed: true,
  theme: 'imperial',
  accent: 'yellow',
  emit: 'opencode-global',
  target: '/home/u/.config/opencode',
  build_time: '2026-06-12 09:41',
  doctor: { ok: false, problems: ['1 dead cross-link'], checked_at: '2026-06-12' },
  diff: { edited: 3, added: 1, missing: 0 },
  counts: { agents: 16, skills: 25, laws: 20, memory: 41, notebook: 6, wiki: 128, config: 4 },
}
const themes = [
  { name: 'imperial', accent: 'yellow', tagline: '', sigil: 'The Codex in force.', blurb: '' },
]
const setup = {
  installed_fp: 'a3f1c9e2',
  source_fp: 'a3f1c9e2',
  version_verdict: 'up to date (0.1.0)',
}
const runs = [
  {
    id: 'j1',
    action: 'doctor',
    status: 'done',
    output: '',
    duration: 4,
    started: Date.now() / 1000 - 120,
  },
]

describe('Dashboard', () => {
  it('renders the status direction with ring, KPIs, and genome counts', async () => {
    render(
      <Dashboard
        overview={overview}
        themes={themes}
        setup={setup}
        runs={runs}
        onAction={() => {}}
      />,
    )
    await waitFor(() => expect(screen.getByText('germination')).toBeTruthy())
    // The healthy fleet has answered, so the voice line stands beside its verdict.
    await waitFor(() => expect(screen.getByText('Harness healthy.')).toBeTruthy())
    expect(screen.getByText('The Codex in force')).toBeTruthy() // headline
    expect(screen.getByText('The Codex in force.')).toBeTruthy() // sigil (trailing period)
    expect(screen.getAllByText('16').length).toBeGreaterThan(0) // agents KPI + genome
    expect(screen.getByText('128')).toBeTruthy() // wiki genome cell
    // readiness: .40 + .15 (1 problem) + .20 (fp match) + .15 (no missing) = 90%
    expect(screen.getByText('90')).toBeTruthy()
  })

  // A behind install makes the fleet "warn": the voice line ("all is well") gives way to
  // the plain fact, and the verdict says what the Ledger says.
  it('drops the voice line when the fleet verdict is not good', async () => {
    fleet.current = {
      doctor: { ok: true, problems: [] },
      installs: [{ id: 'oc', state: 'active', verdict: 'behind', drift: null }],
    }
    render(
      <Dashboard
        overview={overview}
        themes={themes}
        setup={setup}
        runs={runs}
        onAction={() => {}}
      />,
    )
    await waitFor(() => expect(screen.getByText('Harness needs a look.')).toBeTruthy())
    expect(screen.getByText('Deployed')).toBeTruthy()
    expect(screen.queryByText('The Codex in force')).toBeNull()
  })

  // A fleet that failed is not "not answered yet": nothing vouches for the harness, so the
  // voice line ("all is well") does not speak either.
  it('drops the voice line when the fleet did not answer', async () => {
    fleet.current = new Error('HTTP 500')
    render(
      <Dashboard
        overview={overview}
        themes={themes}
        setup={setup}
        runs={runs}
        onAction={() => {}}
      />,
    )
    await waitFor(() => expect(screen.getByText('Deployed')).toBeTruthy())
    expect(screen.queryByText('The Codex in force')).toBeNull()
  })

  // The rejection carries an empty message on purpose: a failed state read off useAsync's
  // `error` string would take it for success.
  it('tells a failed doctor apart from a loading one', async () => {
    render(
      <Dashboard
        overview={overview}
        themes={themes}
        setup={setup}
        runs={runs}
        layout="greenhouse"
        onAction={() => {}}
      />,
    )
    await waitFor(() => expect(screen.getByText('Doctor did not answer')).toBeTruthy())
  })

  // Every finished job bumps `dataRev` and refetches doctor. The last answer must stay on
  // screen while that refetch is out, or the ring blanks to "Checking…" after every run.
  it('keeps the last doctor answer while it refetches', async () => {
    doctor.current = () => Promise.resolve({ groups: [{ label: 'links', problems: [] }] })
    const props = { overview, themes, setup, runs, layout: 'greenhouse', onAction: () => {} }
    const { rerender } = render(<Dashboard {...props} dataRev={0} />)
    await waitFor(() => expect(screen.getByText('1 of 1 checks pass')).toBeTruthy())
    doctor.current = () => new Promise(() => {})
    rerender(<Dashboard {...props} dataRev={1} />)
    expect(screen.getByText('1 of 1 checks pass')).toBeTruthy()
    expect(screen.queryByText('Checking…')).toBeNull()
  })

  it('switches directions via the segmented control', async () => {
    render(
      <Dashboard
        overview={overview}
        themes={themes}
        setup={setup}
        runs={runs}
        onAction={() => {}}
      />,
    )
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

describe('Dashboard with no overview', () => {
  it('shows the load error and a retry instead of loading forever', () => {
    // A failed first overview used to leave "Loading…" up for good (and the boot splash
    // over it). The error is now surfaced with a way to try again.
    const onRetry = vi.fn()
    render(
      <Dashboard
        overview={null}
        overviewError="HTTP 500"
        onRetry={onRetry}
        themes={themes}
        setup={setup}
        runs={runs}
      />,
    )
    expect(screen.getByText(/Could not load the harness overview: HTTP 500/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalled()
  })
})
