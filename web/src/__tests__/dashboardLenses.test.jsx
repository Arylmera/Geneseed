import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// JournalView's constitution map and the KPI strip read the laws catalogue: its `nouns` name
// the tiers in the active theme. Untouched, it answers with no nouns, so the fallbacks show.
const catalog = vi.hoisted(() => ({ current: null }))
vi.mock('../api/index.js', () => ({
  api: {
    catalog: () =>
      catalog.current instanceof Error
        ? Promise.reject(catalog.current)
        : Promise.resolve(catalog.current),
  },
}))
// Both callers share the 'catalog:laws' cache key, so one case's nouns would serve the next.
beforeEach(() => {
  catalog.current = { items: [] }
  clearAsyncCache()
})

import { clearAsyncCache } from '../hooks/useAsync.js'
import KpiStrip from '../pages/Dashboard/KpiStrip.jsx'

import { newestJobs, jobSummary } from '../lib/jobBuckets.js'
import { headlineFor } from '../lib/headlines.js'
import GreenhouseView from '../pages/Dashboard/GreenhouseView.jsx'
import OperatorHudView from '../pages/Dashboard/OperatorHudView.jsx'
import JournalView from '../pages/Dashboard/JournalView.jsx'
import LineageView from '../pages/Dashboard/LineageView.jsx'
import Genome from '../pages/Dashboard/Genome.jsx'

const overview = {
  deployed: true,
  theme: 'imperial',
  emit: 'claude-global',
  target: '/home/u/.claude',
  build_time: '2026-10-20 09:41',
  diff: { edited: 0, added: 0, missing: 0 },
  counts: { agents: 3, skills: 5, laws: 9, memory: 0, notebook: 0, wiki: 0, config: 0 },
}

// Twenty jobs in the order the server sends them: oldest first (started ascending), the way
// js/web/jobs.mjs sorts and useJobs appends. act0 is the oldest, act19 the newest.
const BASE = 1_790_000_000
const CMD = '$ C:\\Users\\u\\node.exe geneseed build --emit claude-global --theme imperial'
const JOBS = Array.from({ length: 20 }, (_, i) => ({
  id: `j${i}`,
  action: `act${i}`,
  status: 'done',
  output: `${CMD}\nrendered 12 files`,
  duration: 3,
  started: BASE + i * 60,
}))

const good = { tone: 'good', head: 'Harness healthy.', facts: [] }
const ok = (groups) => ({ state: 'ok', data: { groups } })
const clean = (n) => Array.from({ length: n }, (_, i) => ({ label: `check ${i}`, problems: [] }))

describe('newestJobs', () => {
  it('returns the n most recently started jobs, newest first, without touching its input', () => {
    const copy = [...JOBS]
    const out = newestJobs(JOBS, 3)
    expect(out.map((j) => j.id)).toEqual(['j19', 'j18', 'j17'])
    expect(JOBS).toEqual(copy)
  })
  it('treats a missing list as empty', () => {
    expect(newestJobs(null, 5)).toEqual([])
  })
})

describe('jobSummary', () => {
  // Verb is the action's first word (local runs label `build (theme · emit)`), scope is the
  // values of --emit/--theme/--scope on the `$` line, result is a mark, duration is
  // seconds or a dash while the job has none yet.
  // --out is NOT scope: its value is an absolute path, and the `$` line joins argv unquoted
  // (js/web/jobs.mjs), so a path with a space would be cut at it.
  it('leaves --out out of the scope', () => {
    const out = '$ geneseed build --emit claude-global --out C:\\Users\\My Name\\h'
    expect(jobSummary({ action: 'build', status: 'done', output: out }).scope).toBe('claude-global')
  })
  // A flag with no value must not take the next flag for one.
  it('skips a flag whose next word is another flag', () => {
    const out = '$ geneseed build --emit --theme imperial'
    expect(jobSummary({ action: 'build', status: 'done', output: out }).scope).toBe('imperial')
  })
  it('reads a finished job', () => {
    expect(
      jobSummary({
        action: 'build (theme · emit)',
        status: 'done',
        duration: 4,
        output: `${CMD}\nok`,
      }),
    ).toEqual({
      verb: 'build',
      scope: 'claude-global · imperial',
      result: '✓',
      duration: '4s',
      command: CMD,
    })
  })
  it('reads a failed job and a running one', () => {
    expect(
      jobSummary({
        action: 'doctor',
        status: 'failed',
        duration: 2,
        output: '$ geneseed doctor\n[web] ✗ command exited with code 1',
      }),
    ).toEqual({
      verb: 'doctor',
      scope: '',
      result: '✗',
      duration: '2s',
      command: '$ geneseed doctor',
    })
    expect(jobSummary({ action: 'update', status: 'running', duration: null, output: '' })).toEqual(
      {
        verb: 'update',
        scope: '',
        result: '…',
        duration: '—',
        command: '',
      },
    )
  })
})

describe('headlineFor', () => {
  // The voice line is a promise that all is well, so it only speaks when the fleet verdict
  // agrees (or has not answered yet); a warn/bad fleet gets the plain fact instead.
  it('speaks the voice only on a good or unknown verdict', () => {
    expect(headlineFor(overview)).toBe('The Codex in force')
    expect(headlineFor(overview, 'good')).toBe('The Codex in force')
    expect(headlineFor(overview, 'warn')).toBe('Deployed')
    expect(headlineFor(overview, 'bad')).toBe('Deployed')
    expect(headlineFor(overview, 'failed')).toBe('Deployed')
    expect(headlineFor({ ...overview, deployed: false }, 'good')).toBe('Not deployed')
  })
})

const greenhouse = (lens, extra = {}) =>
  render(
    <GreenhouseView
      overview={overview}
      sigil=""
      jobs={JOBS}
      lens={lens}
      onAction={() => {}}
      {...extra}
    />,
  )

describe('GreenhouseView', () => {
  it('lists the newest runs, not the oldest, and counts what it shows', () => {
    greenhouse({ verdict: good, doctor: ok(clean(2)) })
    expect(screen.getByText('act19')).toBeTruthy()
    expect(screen.queryByText('act0')).toBeNull()
    expect(screen.getByText('last 12 runs')).toBeTruthy()
    // The raw command is a tooltip, never visible text.
    expect(document.body.textContent).not.toContain('$ C:')
    expect(document.querySelector(`[title="${CMD.replace(/\\/g, '\\\\')}"]`)).toBeTruthy()
  })

  it('draws a full ring when every check passes', () => {
    const { container } = greenhouse({ verdict: good, doctor: ok(clean(15)) })
    const d = container.querySelector('.b-hero-ring path').getAttribute('d')
    // Two half-arcs: a single arc whose start equals its end draws nothing.
    expect(d.match(/A /g).length).toBe(2)
  })

  it('draws an empty track while doctor is loading', () => {
    const { container } = greenhouse({ verdict: good, doctor: { state: 'loading', data: null } })
    expect(container.querySelector('.b-hero-ring .donut-c-num').textContent).toBe('0')
    expect(container.querySelector('.b-hero-ring path')).toBeNull()
    expect(screen.queryByText(/0\/1 checks/)).toBeNull()
    expect(screen.getByText('Checking…')).toBeTruthy()
  })

  it('says doctor did not answer, and offers to run it', () => {
    const onAction = vi.fn()
    greenhouse({ verdict: good, doctor: { state: 'failed', data: null } }, { onAction })
    expect(screen.getByText('Doctor did not answer')).toBeTruthy()
    expect(screen.queryByText(/checks pass now/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Run doctor/ }))
    expect(onAction).toHaveBeenCalledWith('doctor')
  })

  it('shows the fleet verdict beside the headline', () => {
    greenhouse({
      verdict: { tone: 'bad', head: 'Harness has problems.', facts: [] },
      tone: 'bad', // useLensData's headline tone, the verdict's here
      doctor: ok([]),
    })
    expect(screen.getByText('Harness has problems.')).toBeTruthy()
    expect(screen.getByText('Deployed')).toBeTruthy()
  })
})

describe('OperatorHudView', () => {
  it('puts the newest run first, with the command as a tooltip only', () => {
    render(
      <OperatorHudView
        overview={overview}
        jobs={JOBS}
        lens={{ verdict: good, doctor: ok(clean(2)) }}
        onAction={() => {}}
      />,
    )
    // The run log is RunChips: the first chip is the newest run, its scope and age on the
    // second line, its duration as `3 s`. The `$` line stays in the title, never the text.
    const chip = screen.getByText('RECENT // RUN LOG').closest('.c-mod').querySelector('.run-chip')
    expect(chip.textContent).toContain('act19')
    expect(chip.textContent).toContain('claude-global · imperial')
    expect(chip.textContent).toContain('3 s')
    expect(document.body.textContent).not.toContain('$ C:')
    expect([...document.querySelectorAll('[title]')].some((e) => e.title === CMD)).toBe(true)
    expect(screen.getByText('Harness healthy.')).toBeTruthy()
  })

  it('names a doctor that did not answer', () => {
    render(
      <OperatorHudView
        overview={overview}
        jobs={[]}
        lens={{ verdict: good, doctor: { state: 'failed', data: null } }}
        onAction={() => {}}
      />,
    )
    expect(screen.getByText('Doctor did not answer.')).toBeTruthy()
  })
})

describe('JournalView', () => {
  it('shows the fleet verdict in its header', async () => {
    render(
      <JournalView
        overview={overview}
        recent={null}
        lens={{ verdict: { tone: 'warn', head: 'Harness needs a look.', facts: [] } }}
        onAction={() => {}}
        dataRev={0}
      />,
    )
    await waitFor(() => expect(screen.getByText('Harness needs a look.')).toBeTruthy())
  })

  const journal = () =>
    render(
      <JournalView
        overview={overview}
        recent={null}
        lens={{ verdict: good }}
        onAction={() => {}}
        dataRev={0}
      />,
    )

  // The tiers carry the theme's own nouns, as the Laws page does — visible text and the
  // node's accessible name alike.
  it('names the tiers with the themed nouns from the catalogue', async () => {
    catalog.current = {
      items: [],
      nouns: { ontology: 'Credo', law: 'Dictate', laws: 'Edicts', doctrines: 'Doctrinae' },
    }
    journal()
    await waitFor(() => expect(screen.getByText('Credo')).toBeTruthy())
    expect(screen.getByText('Edicts')).toBeTruthy()
    expect(screen.getByText('Doctrinae')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Credo: 0 sections' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edicts: 9, never broken' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Doctrinae: 0 rules chosen at build' })).toBeTruthy()
    expect(screen.queryByText('Ethos')).toBeNull()
    expect(screen.queryByText('Dictates')).toBeNull()
  })

  // A catalogue without nouns falls back to the Laws page's own defaults.
  it('falls back to Ethos / Dictates / Doctrines without nouns', async () => {
    journal()
    await waitFor(() => expect(screen.getByText('Ethos')).toBeTruthy())
    expect(screen.getByText('Dictates')).toBeTruthy()
    expect(screen.getByText('Doctrines')).toBeTruthy()
  })
})

describe('KpiStrip', () => {
  it('labels the invariant tile with the themed noun', async () => {
    catalog.current = { items: [], nouns: { laws: 'Edicts' } }
    render(<KpiStrip overview={overview} dataRev={0} />)
    await waitFor(() => expect(screen.getByText('Edicts')).toBeTruthy())
    expect(screen.queryByText('Dictates')).toBeNull()
  })
  it('falls back to Dictates without nouns', async () => {
    render(<KpiStrip overview={overview} dataRev={0} />)
    await waitFor(() => expect(screen.getByText('Dictates')).toBeTruthy())
  })
  // A failed fetch must not be cached under the shared key: the map (and the Laws page)
  // mounting next with the same dataRev fetches again and gets the real nouns.
  it('does not leave a failed fetch in the shared cache', async () => {
    catalog.current = new Error('HTTP 500')
    const { unmount } = render(<KpiStrip overview={overview} dataRev={0} />)
    await waitFor(() => expect(screen.getByText('Dictates')).toBeTruthy())
    unmount()
    catalog.current = { items: [], nouns: { laws: 'Edicts' } }
    render(<KpiStrip overview={overview} dataRev={0} />)
    await waitFor(() => expect(screen.getByText('Edicts')).toBeTruthy())
  })
})

describe('LineageView', () => {
  const lineage = (version_verdict) =>
    render(<LineageView overview={overview} sigil="" setup={{ version_verdict }} jobs={[]} />)

  it('does not claim sync when the installed build differs', () => {
    const v =
      'installed build differs from this source — run `./geneseed update` (or rebuild) to apply it'
    lineage(v)
    expect(screen.queryByText(/in sync/)).toBeNull()
    const badge = screen.getByText('behind source')
    expect(badge.closest('[title]').title).toBe(v)
    expect(document.body.textContent).not.toContain('`')
  })

  it('reads in sync from the verdict', () => {
    lineage('up to date with this source')
    expect(screen.getByText('in sync')).toBeTruthy()
  })

  it('reads not installed, and stays neutral with no verdict', () => {
    const { unmount } = render(
      <LineageView
        overview={overview}
        sigil=""
        setup={{ version_verdict: 'no Geneseed install detected to compare' }}
        jobs={[]}
      />,
    )
    expect(screen.getByText('not installed')).toBeTruthy()
    unmount()
    render(<LineageView overview={overview} sigil="" setup={null} jobs={[]} />)
    expect(screen.queryByText('behind source')).toBeNull()
    expect(screen.queryByText(/in sync/)).toBeNull()
  })
})

// LN-4: each genome cell opens its section. A <div onClick> has no role and no tab stop, so
// keyboard and screen-reader users could not open one; a real link can, and middle-click works.
describe('Genome', () => {
  it('makes each cell a link to its section', () => {
    render(<Genome overview={overview} />)
    const agents = screen.getByRole('link', { name: /^Agents/ })
    expect(agents.getAttribute('href')).toBe('#/section/agents')
    // One per SECTION_ORDER entry: agents, skills, laws, memory, notebook.
    expect(screen.getAllByRole('link').length).toBe(5)
  })
})
