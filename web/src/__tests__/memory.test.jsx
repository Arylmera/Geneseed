import React from 'react'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The Memory page (pages/Memory.jsx): the store's numbers, the learn decisions, the cleanup and what waits for the
// user, the topics, the fact reader, the recent decisions and the archive. Everything it shows comes from one
// read, GET /api/memory (js/web/memory-api.mjs), stubbed here; the fact list is the real Library reader.

vi.mock('../api/index.js', () => ({
  api: {
    memory: vi.fn(),
    memoryDecide: vi.fn(),
    memoryRestore: vi.fn(),
    rules: vi.fn(),
    rulesPromote: vi.fn(),
    catalog: vi.fn(),
    item: vi.fn(),
    memoryDelete: vi.fn(),
  },
}))

import Memory, { perDay } from '../pages/Memory.jsx'
import { api } from '../api/index.js'
import { ConfirmContext } from '../hooks/useConfirm.jsx'

const NOW = Date.parse('2026-11-25T12:00:00Z')
const state = (over = {}) => ({
  store: '/home/u/.config/geneseed/memory',
  facts: 3,
  topics: [
    { topic: 'release', n: 2, bytes: 300 },
    { topic: 'web', n: 1, bytes: 120 },
  ],
  mapBytes: 400,
  archivedCount: 1,
  archived: [{ name: 'old-fact', desc: 'an old one', mtime: 1 }],
  plan: { at: null, reviewed: 0, pending: [] },
  backups: [],
  log: [],
  learn: { host: 'claude', model: 'haiku', command: 'claude -p --model haiku' },
  ...over,
})
let memoryItems
let current
beforeEach(() => {
  vi.clearAllMocks()
  current = state()
  memoryItems = [
    { name: 'fact-0', title: 'Fact 0', topic: 'release' },
    { name: 'fact-1', title: 'Fact 1', topic: 'release' },
    { name: 'fact-2', title: 'Fact 2', topic: 'web' },
  ]
  api.memory.mockImplementation(() => Promise.resolve(current))
  api.catalog.mockImplementation((section) => Promise.resolve({ section, items: memoryItems }))
  api.item.mockImplementation((type, name) =>
    Promise.resolve({ name, title: '', desc: '', body: '', links: [] }),
  )
  api.rules.mockImplementation(() =>
    Promise.resolve({ exists: true, fingerprint: 'f', stats: { rules: 0 }, rules: [] }),
  )
})
const page = (props = {}) =>
  render(
    <ConfirmContext.Provider value={async () => true}>
      <Memory dataRev={0} onAction={vi.fn()} {...props} />
    </ConfirmContext.Provider>,
  )

describe('perDay', () => {
  // 30 local days ending today, oldest first; a line older than that, or with no date, counts nowhere, and an
  // unknown decision is not a row.
  it('counts each decision per day over the last 30 days', () => {
    const rows = perDay(
      [
        { at: '2026-11-25T08:00:00Z', decision: 'created' },
        { at: '2026-11-25T09:00:00Z', decision: 'created' },
        { at: '2026-11-24T09:00:00Z', decision: 'duplicate' },
        { at: '2026-10-01T09:00:00Z', decision: 'created' },
        { at: 'not a date', decision: 'failed' },
        { at: '2026-11-25T09:00:00Z', decision: 'invented' },
      ],
      NOW,
    )
    expect(rows.created.length).toBe(30)
    expect(rows.created.at(-1)).toBe(2)
    expect(rows.duplicate.at(-2)).toBe(1)
    expect(rows.created.reduce((a, b) => a + b, 0)).toBe(2)
    expect(rows.failed.reduce((a, b) => a + b, 0)).toBe(0)
    expect(Object.keys(rows)).toEqual([
      'created',
      'merged',
      'archived',
      'duplicate',
      'nothing',
      'failed',
    ])
  })
})

describe('Memory', () => {
  it('heads the page with the store numbers', async () => {
    page()
    await screen.findByText('Learn decisions · 30 days')
    const stat = (label) => screen.getByText(label, { selector: '.stat-label' }).closest('.stat')
    expect(stat('Facts').textContent).toContain('2 topics')
    expect(stat('Archived').querySelector('.stat-value').textContent).toBe('1')
    expect(stat('Index at session start').textContent).toContain('~100 tokens')
    expect(stat('Largest topic file').textContent).toContain('release · 2 facts')
  })

  it('an empty store shows "No facts yet" and links to the docs and the rule skill', async () => {
    current = state({ facts: 0, topics: [], archivedCount: 0, archived: [], log: [] })
    const { container } = page()
    expect(await screen.findByText('No facts yet')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'How memory works' }).getAttribute('href')).toBe(
      '#/docs/memory',
    )
    expect(screen.getByRole('link', { name: 'The rule skill' }).getAttribute('href')).toBe(
      '#/item/skill/rule',
    )
    expect(container.querySelector('.library')).toBeNull()
  })

  // Topics sort by family (the slug's first `-` segment), then by full slug.
  it('puts topics of one family side by side, and a pill narrows the facts', async () => {
    current = state({
      topics: [
        { topic: 'web', n: 1, bytes: 1 },
        { topic: 'geneseed-git', n: 1, bytes: 1 },
        { topic: 'release', n: 2, bytes: 1 },
        { topic: 'geneseed', n: 1, bytes: 1 },
      ],
    })
    const { container } = page()
    const topics = await screen.findByRole('region', { name: 'Topics' })
    const names = within(topics)
      .getAllByRole('button')
      .map((b) => b.querySelector('.pm-chip-name').textContent)
    expect(names).toEqual(['geneseed', 'geneseed-git', 'release', 'web'])
    const rows = () => container.querySelectorAll('.lib-row').length
    await waitFor(() => expect(rows()).toBe(3))
    fireEvent.click(within(topics).getByRole('button', { name: /^web/ }))
    await waitFor(() => expect(rows()).toBe(1))
  })

  // A forget archives the fact server-side: the page reads the store again, so the numbers follow.
  it('a forget in the reader reads the store again', async () => {
    api.memoryDelete.mockImplementation(() => {
      current = state({ facts: 2, archivedCount: 2 })
      memoryItems = memoryItems.slice(1)
      return Promise.resolve({ archived: 'fact-0' })
    })
    page({ item: 'fact-0' })
    fireEvent.click(await screen.findByText('Forget this fact'))
    await waitFor(() => expect(api.memoryDelete).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(
        screen.getByText('Archived', { selector: '.stat-label' }).nextSibling.textContent,
      ).toBe('2'),
    )
  })

  it('the decisions card sums the log and draws one row per decision', async () => {
    const today = new Date().toISOString()
    current = state({
      log: [
        { at: today, source: 'learn', decision: 'created', slug: 'a' },
        { at: today, source: 'learn', decision: 'duplicate', slug: 'b', of: 'a' },
        {
          at: today,
          source: 'consolidate',
          decision: 'archived',
          slug: 'c',
          reason: 'task residue',
        },
      ],
    })
    page()
    const card = (await screen.findByText('Learn decisions · 30 days')).closest('section')
    expect(within(card).getByText('3 decisions')).toBeTruthy()
    expect(card.querySelectorAll('.mem-rows li')).toHaveLength(6)
    const recent = screen.getByText('Recent decisions').closest('section')
    expect(recent.textContent).toContain('b → a')
    expect(recent.textContent).toContain('task residue')
  })

  // Preview is the cleanup's dry run: it starts the job and asks nothing. Clean up asks first. With no learn model
  // baked into the install, both are off and the card says how to get one.
  it('starts the cleanup job, as a preview or after a confirm', async () => {
    const onAction = vi.fn()
    page({ onAction })
    fireEvent.click(await screen.findByText('Preview cleanup'))
    expect(onAction).toHaveBeenCalledWith('memory-clean', { dryRun: true })
    fireEvent.click(screen.getByText('Clean up now'))
    await waitFor(() => expect(onAction).toHaveBeenCalledWith('memory-clean', {}))
  })

  it('without a learn model the cleanup buttons are off', async () => {
    current = state({ learn: null })
    page()
    expect((await screen.findByText('Preview cleanup')).disabled).toBe(true)
    expect(screen.getByText('Clean up now').disabled).toBe(true)
    expect(screen.getByText(/rebuild it with --learn light/)).toBeTruthy()
  })

  it('decides what waits: one by one, or all', async () => {
    current = state({
      plan: {
        at: '2026-11-25T08:00:00Z',
        reviewed: 3,
        pending: [{ slug: 'fact-1', action: 'archive', reason: 'task residue', low: true }],
      },
    })
    api.memoryDecide.mockImplementation(() =>
      Promise.resolve({ ok: true, applied: ['fact-1'], stale: [] }),
    )
    page()
    const card = (await screen.findByText('Waiting for you', { selector: 'h3' })).closest('section')
    expect(card.textContent).toContain('archive fact-1')
    fireEvent.click(within(card).getByText('Apply'))
    await waitFor(() => expect(api.memoryDecide).toHaveBeenCalledWith({ names: ['fact-1'] }))
    fireEvent.click(within(card).getByText('Reject all'))
    await waitFor(() => expect(api.memoryDecide).toHaveBeenCalledWith({ all: true, reject: true }))
  })

  it('restores an archived fact, and says why when it cannot', async () => {
    api.memoryRestore.mockImplementation(() =>
      Promise.resolve({ ok: false, error: 'a live fact old-fact already holds that name' }),
    )
    page()
    const card = (await screen.findByText('Archived', { selector: 'h2' })).closest('section')
    fireEvent.click(within(card).getByText('Restore'))
    await waitFor(() => expect(api.memoryRestore).toHaveBeenCalledWith('old-fact'))
    expect(await within(card).findByRole('alert')).toHaveProperty(
      'textContent',
      'a live fact old-fact already holds that name',
    )
  })
})
