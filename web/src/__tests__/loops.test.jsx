import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The Loops page over a fixture `/api/loops` payload: the template cards, the ring for the
// selected one with a card per brick, the Bricks tab with its sources, and the announced but
// disabled Active tab. The ring's geometry is lib/loopRing.js's suite; this one pins the page.
vi.mock('../api/index.js', () => ({ api: { loops: vi.fn() } }))

import Loops from '../pages/Loops.jsx'
import { api } from '../api/index.js'
import { clearAsyncCache } from '../hooks/useAsync.js'

const brick = (name, effect, extra = {}) => ({
  name,
  description: `${name} does its step.`,
  effect,
  agent: 'developer',
  skill: null,
  outcomes: ['pass', 'fail'],
  body: `Body of ${name}.`,
  origin: 'shipped',
  available: true,
  reason: null,
  ...extra,
})
const GRAPH = {
  name: 'tiny',
  nodes: ['setup', 'identify', 'apply'],
  start: 'setup',
  edges: [
    { from: 'setup', on: 'pass', to: 'identify' },
    { from: 'identify', on: 'more', to: 'apply' },
    { from: 'identify', on: 'done', to: '$close' },
    { from: 'apply', on: 'pass', to: 'identify' },
  ],
  loops: [{ name: 'iterations', nodes: ['identify', 'apply'], max: 7, iteration: true }],
}
const PAYLOAD = {
  templates: [
    { name: 'tiny', description: 'The smallest loop.', origin: 'shipped', graph: GRAPH },
    {
      name: 'other',
      description: 'Another.',
      origin: 'project',
      graph: { ...GRAPH, name: 'other' },
    },
  ],
  bricks: [
    brick('apply', 'mutate', { origin: 'project', body: 'Do it our way.' }),
    brick('identify', 'read'),
    brick('lint', 'read', { available: false, reason: 'skill lint is not shipped' }),
    brick('setup', 'read'),
  ],
  overridden: ['apply (project, overrides shipped)'],
}

beforeEach(() => {
  clearAsyncCache()
  api.loops.mockImplementation(() => Promise.resolve(PAYLOAD))
})
afterEach(() => vi.clearAllMocks())

describe('Loops', () => {
  it('lists the templates and draws the first one with a card per brick', async () => {
    render(<Loops tab="templates" />)
    expect(await screen.findByText('The smallest loop.')).toBeTruthy()
    const cards = [...document.querySelectorAll('.loop-tpl b')].map((b) => b.textContent)
    expect(cards).toEqual(['tiny', 'other'])
    expect(document.querySelector('.loop-tpl.on b').textContent).toBe('tiny')
    // The ring: centre text, the gate before apply (its only mutate node), the setup entry.
    const svg = document.querySelector('svg.loop-ring')
    expect(svg.textContent).toContain('iterations · max 7')
    expect(svg.querySelectorAll('.lr-gate')).toHaveLength(1)
    expect(svg.textContent).toContain('setup · 1×')
    // One card per node, in graph order; mutate highlighted; the override said.
    const brickCards = [...document.querySelectorAll('.loop-brick')]
    expect(brickCards.map((c) => c.querySelector('b').textContent)).toEqual([
      'setup',
      'identify',
      'apply',
    ])
    const apply = document.getElementById('brick-apply')
    expect(apply.querySelector('.tag.warn').textContent).toBe('mutate')
    expect(apply.textContent).toContain('overrides shipped')
  })

  it('opens the routed template', async () => {
    render(<Loops tab="templates" item="other" />)
    await screen.findByText('Another.')
    expect(document.querySelector('.loop-tpl.on b').textContent).toBe('other')
  })

  it('scrolls to the brick card when its node is clicked', async () => {
    render(<Loops tab="templates" />)
    await screen.findByText('The smallest loop.')
    const card = document.getElementById('brick-identify')
    card.scrollIntoView = vi.fn()
    fireEvent.click(screen.getByRole('button', { name: 'identify brick' }))
    expect(card.scrollIntoView).toHaveBeenCalled()
  })

  it('lists every brick with its source, dimming the unavailable one with its reason', async () => {
    render(<Loops tab="bricks" />)
    await screen.findByText('Do it our way.')
    const names = [...document.querySelectorAll('.loop-brick b')].map((b) => b.textContent)
    expect(names).toEqual(['apply', 'identify', 'lint', 'setup'])
    const lint = document.getElementById('brick-lint')
    expect(lint.classList.contains('dimmed')).toBe(true)
    expect(lint.textContent).toContain('Unavailable: skill lint is not shipped')
    expect(document.getElementById('brick-apply').querySelector('pre').textContent).toBe(
      'Do it our way.',
    )
  })

  it('shows Active as a disabled v2 tab, not a link', async () => {
    render(<Loops tab="templates" />)
    await screen.findByText('The smallest loop.')
    const tabs = [...document.querySelectorAll('nav.tabs a')].map((a) => a.textContent)
    expect(tabs).toEqual(['Templates2', 'Bricks4'])
    const off = document.querySelector('nav.tabs .tab-off')
    expect(off.textContent).toBe('Active v2')
    expect(off.getAttribute('aria-disabled')).toBe('true')
  })

  it('says so when the catalogue cannot be read', async () => {
    api.loops.mockImplementation(() => Promise.reject(new Error('boom')))
    render(<Loops tab="templates" />)
    expect(await screen.findByText(/boom/)).toBeTruthy()
  })

  it('has an empty state with nowhere-to-add advice', async () => {
    api.loops.mockImplementation(() =>
      Promise.resolve({ templates: [], bricks: [], overridden: [] }),
    )
    render(<Loops tab="templates" />)
    expect(await screen.findByText('No templates')).toBeTruthy()
  })
})
