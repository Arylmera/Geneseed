import React, { useEffect } from 'react'
import { act, render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// App's routing, observed from the outside: a hash goes in, and the test reads which page
// rendered, with which props, which sidebar row lit, and what the breadcrumb says. Every
// page is a stub that prints its routing props and counts its own mounts: the pages' real
// behaviour is their own suites' business; what is pinned here is the dispatch.

// vi.hoisted: the vi.mock factories below are hoisted above every import and declaration,
// so whatever they close over must be hoisted with them.
const { mounts, stub } = vi.hoisted(() => {
  const mounts = {}
  const stub = (name) =>
    function Stub(props) {
      useEffect(() => {
        mounts[name] = (mounts[name] || 0) + 1
      }, [])
      const shown = ['section', 'selected', 'tab', 'item', 'sid', 'page']
        .filter((k) => props[k] !== undefined)
        .map((k) => `${k}=${props[k]}`)
        .join(' ')
      return <div data-testid="page">{`${name}${shown ? ' ' + shown : ''}`}</div>
    }
  return { mounts, stub }
})

vi.mock('../pages/Overview/index.jsx', () => ({ default: stub('Overview') }))
vi.mock('../pages/Activity.jsx', () => ({ default: stub('Activity') }))
vi.mock('../pages/ActivityDetail.jsx', () => ({ default: stub('ActivityDetail') }))
vi.mock('../pages/Library.jsx', () => ({ default: stub('Library') }))
vi.mock('../pages/Laws.jsx', () => ({ default: stub('Laws') }))
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
