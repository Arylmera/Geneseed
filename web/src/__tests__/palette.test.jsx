import React from 'react'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

// The REAL index hook, with only the network stubbed: the point of several cases below is
// what the palette shows while that network has not answered yet.
vi.mock('../api/index.js', () => ({ api: { catalog: vi.fn(), mcp: vi.fn(), docs: vi.fn() } }))

import Search from '../components/Search.jsx'
import { ConfirmContext } from '../hooks/useConfirm.jsx'
import { api } from '../api/index.js'

const never = () => new Promise(() => {})

// jsdom has no layout, so no scrollIntoView (Spotlight keeps the active row in view with it).
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
})
beforeEach(() => {
  vi.clearAllMocks()
  api.catalog.mockImplementation(never)
  api.mcp.mockImplementation(never)
  api.docs.mockImplementation(never)
  window.location.hash = ''
})

// One field of each kind beside the palette, to press the shortcuts from inside them.
const mount = ({ actions = [], confirm = vi.fn(async () => true) } = {}) => {
  render(
    <ConfirmContext.Provider value={confirm}>
      <input aria-label="other field" />
      <textarea aria-label="notes" />
      <Search actions={actions} />
    </ConfirmContext.Provider>,
  )
  return { confirm }
}
const trigger = () => screen.getByRole('button', { name: /Search or run/ })
const dialog = () => document.querySelector('dialog.palette')
// jsdom has no showModal, so the palette falls back to the `open` attribute, as ConfirmDialog does.
const isOpen = () => !!dialog()?.hasAttribute('open')
const box = () => screen.getByRole('combobox')
const groups = () => screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))
const titles = () => [...document.querySelectorAll('.spot-title')].map((n) => n.textContent)
const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)))

const doctor = (run = vi.fn()) => ({
  kind: 'Actions',
  title: 'Run doctor',
  desc: 'Read-only health check',
  hay: 'run doctor',
  run,
})

describe('Command palette: opening and closing', () => {
  it('the topbar field is a button that opens a modal dialog with the combobox focused', () => {
    mount()
    expect(trigger().getAttribute('aria-haspopup')).toBe('dialog')
    expect(isOpen()).toBe(false)
    fireEvent.click(trigger())
    expect(isOpen()).toBe(true)
    expect(document.activeElement).toBe(box())
    expect(box().getAttribute('placeholder')).toBe('Search or run…')
  })

  it('`/` opens it from the page, but not from inside another input', () => {
    mount()
    fireEvent.keyDown(screen.getByLabelText('other field'), { key: '/' })
    expect(isOpen()).toBe(false)
    fireEvent.keyDown(document.body, { key: '/' })
    expect(isOpen()).toBe(true)
  })

  it('Ctrl+K opens it even from inside a textarea', () => {
    mount()
    fireEvent.keyDown(screen.getByLabelText('notes'), { key: 'k', ctrlKey: true })
    expect(isOpen()).toBe(true)
  })

  it('Esc clears a query first, then closes and hands focus back to the trigger', () => {
    mount()
    fireEvent.click(trigger())
    fireEvent.change(box(), { target: { value: 'doc' } })
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(isOpen()).toBe(true)
    expect(box().value).toBe('')
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(isOpen()).toBe(false)
    expect(document.activeElement).toBe(trigger())
  })

  // A click whose target is the dialog element itself landed on the backdrop; a click on a
  // child (the field, a row) must not close it.
  it('a click on the backdrop closes it; a click inside does not', () => {
    mount()
    fireEvent.click(trigger())
    fireEvent.click(box())
    expect(isOpen()).toBe(true)
    fireEvent.click(dialog())
    expect(isOpen()).toBe(false)
    expect(document.activeElement).toBe(trigger())
  })

  // The first Esc on a typed query only clears it: the dialog stays open, focus stays in the
  // field, and the empty-query list (the actions) comes back.
  it('Esc with a query clears it and keeps the dialog open and focused', () => {
    mount({ actions: [doctor()] })
    fireEvent.click(trigger())
    fireEvent.change(box(), { target: { value: 'kits' } })
    expect(titles()).not.toContain('Run doctor')
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(isOpen()).toBe(true)
    expect(box().value).toBe('')
    expect(document.activeElement).toBe(box())
    expect(titles()[0]).toBe('Run doctor')
  })
})

describe('Command palette: what it lists', () => {
  // The fetch never answers here: Actions and Pages are known without it, so they show at once.
  it('with an empty query, shows Actions then Pages before the index has loaded', () => {
    mount({ actions: [doctor()] })
    fireEvent.click(trigger())
    expect(api.catalog).toHaveBeenCalled()
    expect(groups()).toEqual(['Actions', 'Pages'])
    expect(titles()[0]).toBe('Run doctor')
    expect(titles()[1]).toBe('Overview')
    expect(screen.queryByText('Loading…')).toBeNull()
  })

  // "doc" hits one action, two pages (a prefix, then an includes), one skill and one docs page.
  // Groups come in a fixed order whatever the score: a title-prefix item never jumps above an
  // includes-only page.
  it('orders the groups Actions, Pages, then the item kinds', async () => {
    api.catalog.mockImplementation(async (sec) => ({
      items: sec === 'skills' ? [{ name: 'doc-writer', desc: '' }] : [],
    }))
    api.mcp.mockResolvedValue({ targets: [] })
    api.docs.mockResolvedValue({
      groups: [{ label: 'Guides', pages: [{ id: 'doctor', title: 'Doctor guide' }] }],
    })
    mount({ actions: [doctor()] })
    fireEvent.click(trigger())
    await flush()
    fireEvent.change(box(), { target: { value: 'doc' } })
    expect(groups()).toEqual(['Actions', 'Pages', 'Skills', 'Docs'])
    expect(titles()).toEqual([
      'Run doctor',
      'Docs',
      'Installs / Doctor',
      'doc-writer',
      'Doctor guide',
    ])
  })
})

describe('Command palette: activating a row', () => {
  const rebuild = (run) => ({
    kind: 'Actions',
    title: 'Rebuild all',
    desc: 'Re-emit every install',
    hay: 'rebuild all',
    run,
    confirm: { msg: 'Rebuild every install?', title: 'Rebuild all?', confirmLabel: 'Rebuild' },
  })

  it('a writing action asks first, and runs only on a yes', async () => {
    const run = vi.fn()
    const answers = [false, true]
    const confirm = vi.fn(async () => answers.shift())
    mount({ actions: [rebuild(run)], confirm })

    fireEvent.click(trigger())
    fireEvent.change(box(), { target: { value: 'rebuild' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    await flush()
    expect(confirm).toHaveBeenCalledWith('Rebuild every install?', {
      title: 'Rebuild all?',
      confirmLabel: 'Rebuild',
    })
    expect(run).not.toHaveBeenCalled()

    fireEvent.click(trigger())
    fireEvent.change(box(), { target: { value: 'rebuild' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    await flush()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenCalledTimes(1)
  })

  // A no, by mouse this time: the handler never runs, and the palette is closed all the same.
  it('a confirm that answers no never runs the handler', async () => {
    const run = vi.fn()
    const confirm = vi.fn(async () => false)
    mount({ actions: [rebuild(run)], confirm })
    fireEvent.click(trigger())
    fireEvent.mouseDown(screen.getAllByRole('option')[0])
    await flush()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(run).not.toHaveBeenCalled()
    expect(isOpen()).toBe(false)
  })

  // Closed BEFORE the action runs, so a confirm it opens sits over the page, not over a
  // palette that is still on its way out.
  it('a read-only action runs without asking, after the palette has closed', async () => {
    let openAtRun = null
    const run = vi.fn(() => {
      openAtRun = isOpen()
    })
    const { confirm } = mount({ actions: [doctor(run)] })
    fireEvent.click(trigger())
    fireEvent.change(box(), { target: { value: 'doctor' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    await flush()
    expect(run).toHaveBeenCalledTimes(1)
    expect(confirm).not.toHaveBeenCalled()
    expect(openAtRun).toBe(false)
    expect(document.activeElement).toBe(trigger())
  })

  it('a page row navigates and closes the palette', () => {
    mount()
    fireEvent.click(trigger())
    fireEvent.change(box(), { target: { value: 'kits' } })
    fireEvent.mouseDown(screen.getAllByRole('option')[0])
    expect(window.location.hash).toBe('#/kits')
    expect(isOpen()).toBe(false)
  })
})
