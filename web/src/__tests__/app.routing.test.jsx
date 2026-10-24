import React, { useEffect } from 'react'
import { act, render, screen, cleanup, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// App's routing, observed from the outside: a hash goes in, and the test reads which page
// rendered, with which props, which sidebar row lit, and what the breadcrumb says. Every
// page is a stub that prints its routing props and counts its own mounts: the pages' real
// behaviour is their own suites' business; what is pinned here is the dispatch.

// vi.hoisted: the vi.mock factories below are hoisted above every import and declaration,
// so whatever they close over must be hoisted with them.
// `crash[name]`, when set, is the message that page's stub throws while rendering.
const { mounts, crash, stub } = vi.hoisted(() => {
  const mounts = {}
  const crash = {}
  const stub = (name) =>
    function Stub(props) {
      if (crash[name]) throw new Error(crash[name])
      useEffect(() => {
        mounts[name] = (mounts[name] || 0) + 1
      }, [])
      const shown = ['section', 'selected', 'tab', 'item', 'sid', 'page']
        .filter((k) => props[k] !== undefined)
        .map((k) => `${k}=${props[k]}`)
        .join(' ')
      return <div data-testid="page">{`${name}${shown ? ' ' + shown : ''}`}</div>
    }
  return { mounts, crash, stub }
})

vi.mock('../pages/Overview/index.jsx', () => ({ default: stub('Overview') }))
vi.mock('../pages/Activity.jsx', () => ({ default: stub('Activity') }))
vi.mock('../pages/ActivityDetail.jsx', () => ({ default: stub('ActivityDetail') }))
vi.mock('../pages/Library.jsx', () => ({ default: stub('Library') }))
vi.mock('../pages/Laws.jsx', () => ({ default: stub('Laws') }))
vi.mock('../pages/Kits.jsx', () => ({ default: stub('Kits') }))
vi.mock('../pages/Loops.jsx', () => ({ default: stub('Loops') }))
vi.mock('../pages/Personal.jsx', () => ({ default: stub('Personal') }))
vi.mock('../pages/Installs/index.jsx', () => ({ default: stub('Installs') }))
vi.mock('../pages/Docs/index.jsx', () => ({ default: stub('Docs') }))
// Every api call the shell makes answers with one empty-ish object; nothing here reads it.
vi.mock('../api/index.js', () => ({
  api: new Proxy({}, { get: () => () => Promise.resolve({ themes: [], jobs: [], installs: [] }) }),
}))

import App from '../App.jsx'

const navigate = async (hash) => {
  await act(async () => {
    window.location.hash = hash
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}
const page = async () => (await screen.findByTestId('page')).textContent
const lit = () => document.querySelector('.sidebar a.sb-item.on')?.textContent
const crumb = () => document.querySelector('.crumbs [aria-current="page"]')?.textContent

beforeEach(() => {
  for (const k of Object.keys(mounts)) delete mounts[k]
  for (const k of Object.keys(crash)) delete crash[k]
  window.sessionStorage.setItem('gs-booted', '1') // skip the splash
  window.location.hash = '#/'
})
afterEach(() => cleanup())

// hash -> [the page and routing props it renders, the sidebar row that lights, the last
// breadcrumb]. The retired pages are the rows that matter most: each one names where an
// old bookmark lands now.
const TABLE = [
  ['#/', 'Overview', 'Overview', 'Overview'],
  ['#/nonsense', 'Overview', 'Overview', 'Overview'],
  ['#/dashboard', 'Overview', 'Overview', 'Overview'],
  ['#/laws', 'Laws', 'Constitution', 'Constitution'],
  ['#/section/laws', 'Laws', 'Constitution', 'Constitution'],
  ['#/item/law/IV', 'Laws selected=IV', 'Constitution', 'Constitution'],
  ['#/library', 'Library', 'Library', 'Library'],
  ['#/skills', 'Library section=skills', 'Library', 'Library'],
  ['#/item/skill/tdd', 'Library section=skills selected=tdd', 'Library', 'Library'],
  ['#/agents', 'Library section=agents', 'Library', 'Library'],
  ['#/section/agents', 'Library section=agents', 'Library', 'Library'],
  ['#/item/agent/advocate', 'Library section=agents selected=advocate', 'Library', 'Library'],
  ['#/section/memory', 'Library section=memory', 'Library', 'Library'],
  // Names are URI-decoded, so a space or a slash in a name survives the round trip.
  ['#/item/memory/a%20b', 'Library section=memory selected=a b', 'Library', 'Library'],
  ['#/item/notebook/x%2Fy', 'Library section=notebook selected=x/y', 'Library', 'Library'],
  ['#/section/config', 'Library section=config', 'Library', 'Library'],
  ['#/kits', 'Kits', 'Kits', 'Kits'],
  ['#/kits/spring-boot', 'Kits item=spring-boot', 'Kits', 'Kits'],
  ['#/loops', 'Loops tab=templates', 'Loops', 'Templates'],
  ['#/loops/templates/bugfix', 'Loops tab=templates item=bugfix', 'Loops', 'Templates'],
  ['#/personal', 'Personal tab=rules', 'Personal', 'Rules'],
  ['#/rules', 'Personal tab=rules', 'Personal', 'Rules'],
  ['#/profile', 'Personal tab=profile', 'Personal', 'Profile'],
  ['#/personal/memory/f', 'Personal tab=memory item=f', 'Personal', 'Memory'],
  ['#/installs', 'Installs tab=hosts', 'Installs', 'Hosts'],
  ['#/harness', 'Installs tab=hosts', 'Installs', 'Hosts'],
  ['#/harnesses', 'Installs tab=hosts', 'Installs', 'Hosts'],
  ['#/themes', 'Installs tab=hosts', 'Installs', 'Hosts'],
  ['#/diff', 'Installs tab=edits', 'Installs', 'Local edits'],
  ['#/doctor', 'Installs tab=doctor', 'Installs', 'Doctor'],
  ['#/settings', 'Installs tab=server', 'Installs', 'Server'],
  ['#/about', 'Installs tab=server', 'Installs', 'Server'],
  ['#/docs', 'Docs page=', 'Docs', 'Docs'],
  ['#/docs/cli/build', 'Docs page=cli/build', 'Docs', 'Docs'],
  ['#/activity', 'Activity', 'Activity', 'Activity'],
  ['#/activity/s%201', 'ActivityDetail sid=s 1', 'Activity', 'Activity'],
]

describe('App routing', () => {
  it.each(TABLE)(
    '%s renders %s, lights %s, ends the breadcrumb at %s',
    async (hash, expected, row, here) => {
      window.location.hash = hash
      render(<App />)
      expect(await page()).toBe(expected)
      expect(lit()).toMatch(new RegExp(`^${row}`))
      expect(crumb()).toBe(here)
    },
  )
})

// ⚠ App.jsx: a page reachable from several routes must keep ONE slot in the tree, or
// crossing between those routes unmounts it (throwing away its state and refetching).
// Each walk below stays on one page, so that page must mount exactly once.
describe('one slot per page', () => {
  const WALKS = [
    ['Laws', ['#/laws', '#/item/law/IV', '#/item/law/craft.1', '#/section/laws', '#/laws']],
    [
      'Library',
      ['#/skills', '#/agents', '#/library', '#/section/memory', '#/item/agent/x', '#/item/wiki/y'],
    ],
    ['Personal', ['#/rules', '#/profile', '#/personal/memory', '#/personal/memory/f']],
    ['Installs', ['#/harness', '#/diff', '#/doctor', '#/settings', '#/installs/hosts']],
  ]
  it.each(WALKS)('%s mounts once across %j', async (name, hashes) => {
    window.location.hash = hashes[0]
    render(<App />)
    await page()
    for (const h of hashes.slice(1)) {
      await navigate(h)
      expect(await page()).toMatch(new RegExp(`^${name}`))
    }
    expect(mounts[name]).toBe(1)
  })

  it('a different page does remount (the stub counter is live)', async () => {
    window.location.hash = '#/laws'
    render(<App />)
    await page()
    await navigate('#/skills')
    await page()
    await navigate('#/laws')
    expect(await page()).toBe('Laws')
    expect(mounts.Laws).toBe(2)
  })
})

// Focus and title follow the PAGE, not the address: a page change lands a keyboard user on
// `#main` and names the page in the title; an item change inside a page leaves focus where
// it was, or walking a list would throw the user back to the top every step.
describe('focus, title and skip link', () => {
  const main = () => document.getElementById('main')

  it('the skip link focuses #main and keeps the current page', async () => {
    window.location.hash = '#/laws'
    render(<App />)
    await page()
    await act(async () => {
      fireEvent.click(screen.getByText('Skip to content'))
    })
    expect(await page()).toBe('Laws')
    expect(window.location.hash).toBe('#/laws')
    expect(document.activeElement).toBe(main())
  })

  it('the first load names the page but does not move focus', async () => {
    window.location.hash = '#/kits'
    render(<App />)
    await page()
    expect(document.title).toBe('Kits · Geneseed')
    expect(document.activeElement).not.toBe(main())
  })

  it('a page change names the page and focuses #main', async () => {
    window.location.hash = '#/'
    render(<App />)
    await page()
    await navigate('#/laws')
    expect(await page()).toBe('Laws')
    expect(document.title).toBe('Constitution · Geneseed')
    expect(document.activeElement).toBe(main())
  })

  it('an item change on the same page does not move focus', async () => {
    window.location.hash = '#/skills'
    render(<App />)
    await page()
    await navigate('#/item/skill/tdd')
    expect(await page()).toBe('Library section=skills selected=tdd')
    expect(document.activeElement).not.toBe(main())
  })
})

// A page that throws while rendering is caught at the page slot: the chrome survives, and
// another page renders, because the boundary is keyed on the page.
describe('page boundary', () => {
  it('a crashing page shows the error and Retry, keeps the chrome, and another page renders', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      crash.Kits = 'kits exploded'
      window.location.hash = '#/kits'
      render(<App />)
      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toContain('kits exploded')
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
      expect(document.querySelector('.sidebar')).not.toBeNull()
      expect(document.querySelector('.crumbs')).not.toBeNull()
      expect(document.querySelector('.console')).not.toBeNull()
      await navigate('#/laws')
      expect(await page()).toBe('Laws')
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    } finally {
      quiet.mockRestore()
    }
  })
})
