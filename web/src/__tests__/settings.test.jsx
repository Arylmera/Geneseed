import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// Settings is prop-driven now: ServerControl only touches the api on a click, so an
// empty stub keeps the import side-effect-free.
vi.mock('../api/index.js', () => ({ api: {} }))

import Settings from '../pages/Settings/index.jsx'

describe('Settings', () => {
  it('renders maintenance, the update button, and server control', () => {
    render(<Settings onAction={() => {}} />)
    // Per-install detail and build moved to the Harnesses tab + Dashboard; Settings keeps
    // machine maintenance (incl. the git-pull Update) and server control.
    expect(screen.getByText('Add to PATH')).toBeTruthy()
    expect(screen.getByText('Remove from PATH')).toBeTruthy()
    expect(screen.getByText('Uninstall')).toBeTruthy()
    expect(screen.getByText('Update (git pull + rebuild)')).toBeTruthy()
    expect(screen.getByText('Stop server')).toBeTruthy()
  })

  it('shows the footprint dial for the current install', () => {
    render(
      <Settings
        onAction={() => {}}
        overview={{ install: { host: 'opencode', scope: 'global' }, footprint: 'full' }}
      />,
    )
    expect(screen.getByText('Harness footprint')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------------------------
// Doctrine packs — the one control on this page that STAGES its edits.

const PACKS = [
  { pack: 'craft', title: 'Craft', desc: 'how code is written', active: true, rules: 6 },
  { pack: 'rigor', title: 'Rigor', desc: 'how work is proven', active: true, rules: 4 },
  { pack: 'ops', title: 'Ops', desc: 'how the machine is operated', active: true, rules: 6 },
  { pack: 'process', title: 'Process', desc: 'how a task is run', active: true, rules: 7 },
]
const OVERVIEW = (doctrines = PACKS) => ({
  install: { host: 'opencode', scope: 'global' },
  footprint: 'lean',
  doctrines,
})
const sw = (c, name) => c.querySelector(`[aria-label="${name} pack"]`)
const applyBtn = () => screen.getByText(/^Apply/).closest('button')

describe('Settings — doctrine packs', () => {
  it('renders one switch per pack, reflecting what is deployed', () => {
    const off = PACKS.map((p) => (p.pack === 'ops' ? { ...p, active: false } : p))
    const { container } = render(<Settings onAction={() => {}} overview={OVERVIEW(off)} />)
    expect(screen.getByText('Doctrine packs')).toBeTruthy()
    expect(container.querySelectorAll('.pack-toggle').length).toBe(4)
    for (const p of PACKS) expect(sw(container, p.title)).toBeTruthy()
    expect(sw(container, 'Craft').getAttribute('aria-checked')).toBe('true')
    expect(sw(container, 'Ops').getAttribute('aria-checked')).toBe('false')
    // Rule counts come from the payload, never from a literal in the page.
    expect(screen.getByText('7 rules')).toBeTruthy()
  })

  it('stages every toggle and rebuilds ONCE on Apply', () => {
    // ⚠ THE WHOLE POINT OF THE CONTROL. Acting per click would re-emit the install once per
    // switch — three of those rebuilds describing a state nobody asked for, each writing a
    // different `Active packs:` marker.
    const onAction = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { container } = render(<Settings onAction={onAction} overview={OVERVIEW()} />)
    expect(applyBtn().disabled).toBe(true) // nothing staged yet
    fireEvent.click(sw(container, 'Ops'))
    fireEvent.click(sw(container, 'Rigor'))
    expect(onAction).not.toHaveBeenCalled() // still nothing — this is the claim
    expect(applyBtn().disabled).toBe(false)
    fireEvent.click(applyBtn())
    expect(onAction).toHaveBeenCalledTimes(1)
    const [action, body] = onAction.mock.calls[0]
    expect(action).toBe('install')
    // Sent in PACK_ORDER, which is the order the payload arrives in — the marker the build
    // writes is parsed back out later and must compare equal to itself.
    expect(body.doctrines).toEqual(['craft', 'process'])
    expect(body.host).toBe('opencode')
    vi.restoreAllMocks()
  })

  it('turning every pack off is a real selection, not a no-op', () => {
    // An empty list must reach the endpoint as an empty list: the server reads `[]` as the
    // deliberate `--doctrines none`, and anything falsier falls back to ALL packs.
    const onAction = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { container } = render(<Settings onAction={onAction} overview={OVERVIEW()} />)
    for (const p of PACKS) fireEvent.click(sw(container, p.title))
    fireEvent.click(applyBtn())
    expect(onAction.mock.calls[0][1].doctrines).toEqual([])
    vi.restoreAllMocks()
  })

  it('warns before dropping the pack that carries the consent gate', () => {
    // Turning `process` off is SUPPORTED — it is the whole reason packs are toggleable — so
    // this names the consequence rather than refusing it. The gate disappears from the tool
    // boundary along with the rule behind it.
    const onAction = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { container } = render(<Settings onAction={onAction} overview={OVERVIEW()} />)
    fireEvent.click(sw(container, 'Process'))
    expect(screen.getByText(/removes the commit\/push consent/)).toBeTruthy()
    fireEvent.click(applyBtn())
    expect(confirm.mock.calls[0][0]).toMatch(/consent/)
    expect(onAction).toHaveBeenCalledTimes(1) // named, not blocked
    vi.restoreAllMocks()
  })

  it('declining the confirm changes nothing', () => {
    const onAction = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { container } = render(<Settings onAction={onAction} overview={OVERVIEW()} />)
    fireEvent.click(sw(container, 'Ops'))
    fireEvent.click(applyBtn())
    expect(onAction).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('Revert drops the staged edits', () => {
    const { container } = render(<Settings onAction={() => {}} overview={OVERVIEW()} />)
    fireEvent.click(sw(container, 'Ops'))
    expect(sw(container, 'Ops').getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByText('Revert'))
    expect(sw(container, 'Ops').getAttribute('aria-checked')).toBe('true')
    expect(applyBtn().disabled).toBe(true)
  })

  it('a poll that re-renders the same overview does not discard a staged edit', () => {
    // ⚠ `overview` is a FRESH OBJECT on every poll. Re-syncing on its identity would wipe a
    // half-made selection every few seconds, which is unusable and would look like a flaky UI.
    const { container, rerender } = render(<Settings onAction={() => {}} overview={OVERVIEW()} />)
    fireEvent.click(sw(container, 'Ops'))
    rerender(<Settings onAction={() => {}} overview={OVERVIEW()} />) // same values, new object
    expect(sw(container, 'Ops').getAttribute('aria-checked')).toBe('false')
    // ...but a real change on the server DOES win: the install rebuilt without `ops`.
    const off = PACKS.map((p) => (p.pack === 'ops' ? { ...p, active: false } : p))
    rerender(<Settings onAction={() => {}} overview={OVERVIEW(off)} />)
    expect(applyBtn().disabled).toBe(true)
  })

  it('is absent when there is no install to rebuild', () => {
    render(<Settings onAction={() => {}} overview={{ doctrines: PACKS }} />)
    expect(screen.queryByText('Doctrine packs')).toBeNull()
  })
})
