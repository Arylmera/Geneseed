import React, { useEffect } from 'react'
import { act, render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// App's routing, observed from the outside: a hash goes in, and the test reads which page
// rendered, with which props, and which rail row lit. Every page is a stub that prints its
// routing props and counts its own mounts — the pages' real behaviour is their own suites'
// business; what is pinned here is the dispatch, which is what a routing refactor can break.

// vi.hoisted: the vi.mock factories below are hoisted above every import and
// declaration, so whatever they close over must be hoisted with them.
const { mounts, stub } = vi.hoisted(() => {
  const mounts = {}
  const stub = (name) =>
    function Stub(props) {
      useEffect(() => {
        mounts[name] = (mounts[name] || 0) + 1
      }, [])
      const shown = ['section', 'selected', 'sid', 'page']
        .filter((k) => props[k] !== undefined)
        .map((k) => `${k}=${props[k]}`)
        .join(' ')
      return <div data-testid="page">{`${name}${shown ? ' ' + shown : ''}`}</div>
    }
  return { mounts, stub }
})

vi.mock('../pages/Dashboard/index.jsx', () => ({ default: stub('Dashboard') }))
vi.mock('../pages/Activity.jsx', () => ({ default: stub('Activity') }))
vi.mock('../pages/ActivityDetail.jsx', () => ({ default: stub('ActivityDetail') }))
vi.mock('../pages/Library.jsx', () => ({ default: stub('Library') }))
vi.mock('../pages/Laws.jsx', () => ({ default: stub('Laws') }))
vi.mock('../pages/Rules.jsx', () => ({ default: stub('Rules') }))
vi.mock('../pages/Profile.jsx', () => ({ default: stub('Profile') }))
vi.mock('../pages/Skills.jsx', () => ({ default: stub('Skills') }))
vi.mock('../pages/Diff.jsx', () => ({ default: stub('Diff') }))
vi.mock('../pages/Doctor.jsx', () => ({ default: stub('Doctor') }))
vi.mock('../pages/Settings/index.jsx', () => ({ default: stub('Settings') }))
vi.mock('../pages/Harness.jsx', () => ({ default: stub('Harness') }))
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
const lit = () => document.querySelector('a.rail-item.active')?.textContent

beforeEach(() => {
  for (const k of Object.keys(mounts)) delete mounts[k]
  window.sessionStorage.setItem('gs-booted', '1') // skip the splash
  window.location.hash = '#/'
})
afterEach(() => cleanup())

// hash -> [the page and routing props it renders, the rail row that lights].
// The rail label for the laws page is "Constitution" — the route stays #/laws.
const TABLE = [
  ['#/', 'Dashboard', 'Dashboard'],
  ['#/nonsense', 'Dashboard', 'Dashboard'],
  ['#/laws', 'Laws', 'Constitution'],
  ['#/section/laws', 'Laws', 'Constitution'],
  ['#/item/law/IV', 'Laws selected=IV', 'Constitution'],
  ['#/skills', 'Skills', 'Skills'],
  ['#/section/skills', 'Skills', 'Skills'],
  ['#/item/skill/tdd', 'Skills selected=tdd', 'Skills'],
  ['#/agents', 'Library section=agents', 'Agents'],
  ['#/section/agents', 'Library section=agents', 'Agents'],
  ['#/item/agent/advocate', 'Library section=agents selected=advocate', 'Agents'],
  // `#/library` hands no section: Library reads that as "the first chip".
  ['#/library', 'Library', 'Library'],
  ['#/section/memory', 'Library section=memory', 'Library'],
  // Names are URI-decoded, so a space or a slash in a name survives the round trip.
  ['#/item/memory/a%20b', 'Library section=memory selected=a b', 'Library'],
  ['#/item/notebook/x%2Fy', 'Library section=notebook selected=x/y', 'Library'],
  // config has no chip of its own: the resolver folds it onto the wiki (Knowledge) chip.
  ['#/section/config', 'Library section=wiki', 'Library'],
  ['#/item/config/x', 'Library section=wiki selected=x', 'Library'],
  ['#/rules', 'Rules', 'Rules'],
  ['#/profile', 'Profile', 'Profile'],
  ['#/docs', 'Docs page=', 'Docs'],
  ['#/docs/cli/build', 'Docs page=cli/build', 'Docs'],
  ['#/activity', 'Activity', 'Activity'],
  ['#/activity/s%201', 'ActivityDetail sid=s 1', 'Activity'],
  ['#/diff', 'Diff', 'Changes'],
  ['#/doctor', 'Doctor', 'Doctor'],
  ['#/harness', 'Harness', 'Harness'],
  // Retired names still land on the page that absorbed them (router.js VIEW_ALIAS).
  ['#/harnesses', 'Harness', 'Harness'],
  ['#/themes', 'Harness', 'Harness'],
  ['#/settings', 'Settings', 'Settings'],
  ['#/about', 'Settings', 'Settings'],
]

describe('App routing', () => {
  it.each(TABLE)('%s renders %s and lights %s', async (hash, expected, rail) => {
    window.location.hash = hash
    render(<App />)
    expect(await page()).toBe(expected)
    expect(lit()).toMatch(new RegExp(`^${rail}`))
  })
})

// The prompt's --tab flag comes from the same page the rail lights, so the two can no
// longer disagree: `#/section/agents` used to light Agents while the prompt said library.
describe('topbar tab flag', () => {
  it.each([
    ['#/', 'overview'],
    ['#/section/agents', 'agents'],
    ['#/item/law/IV', 'laws'],
    ['#/activity/s1', 'activity'],
    ['#/themes', 'harness'],
  ])('%s -> --tab=%s', async (hash, flag) => {
    window.location.hash = hash
    render(<App />)
    await page()
    expect(document.querySelector('.prompt .flag').textContent).toBe(`--tab=${flag}`)
  })
})

// ⚠ App.jsx: a page reachable from several routes must keep ONE slot in the tree, or
// crossing between those routes unmounts it — expanding a law (`#/laws` -> `#/item/law/IV`)
// used to throw the page's state away and refetch. Each walk below stays on one page, so
// that page must mount exactly once however many routes it crosses.
describe('one slot per page', () => {
  const WALKS = [
    ['Laws', ['#/laws', '#/item/law/IV', '#/item/law/craft.1', '#/section/laws', '#/laws']],
    ['Skills', ['#/skills', '#/item/skill/tdd', '#/section/skills']],
    [
      'Library',
      ['#/agents', '#/library', '#/section/memory', '#/item/agent/x', '#/item/wiki/y', '#/agents'],
    ],
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
