import React from 'react'
import { render, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  PageBar,
  TrackProgress,
  pageNav,
  placeOf,
  trackNav,
  markSeen,
  readSeen,
  SEEN_KEY,
} from '../pages/Docs/Track.jsx'

// The Understand track: four pages, then Guides. A step is "done" when read before and
// "on" when open; prev/next walk the track, and next on the last step leaves it for the
// first page of the group after it.
const MENU = {
  groups: [
    {
      id: 'understand',
      label: 'Understand',
      pages: [
        { id: 'harness', title: 'What a harness is' },
        { id: 'machine', title: 'What lands on your machine' },
        { id: 'day', title: 'A day with the harness' },
        { id: 'enforced', title: 'Enforced vs. asked' },
      ],
    },
    { id: 'guides', label: 'Guides', pages: [{ id: 'install', title: 'Install' }] },
  ],
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('Track', () => {
  it('counts the read pages on the progress line', () => {
    const pages = MENU.groups[0].pages
    const { container } = render(<TrackProgress pages={pages} seen={['harness', 'day']} />)
    const bar = container.querySelector('.track-prog')
    expect([bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemax')]).toEqual([
      '2',
      '4',
    ])
    expect(bar.querySelector('i').style.width).toBe('50%')
  })

  it('walks prev and next along the track', () => {
    expect(trackNav(MENU, 'machine')).toEqual({
      prev: { id: 'harness', title: 'What a harness is' },
      next: { id: 'day', title: 'A day with the harness' },
    })
  })

  it('sends next on the last step to the first Guides page', () => {
    expect(trackNav(MENU, 'enforced').next).toEqual({ id: 'install', title: 'Install' })
  })

  it('has no bar off the track', () => {
    expect(trackNav(MENU, 'install')).toEqual({ prev: null, next: null })
  })

  // Real links in a named navigation: they open in a new tab and say where they go.
  it('links the bar to the pages, in a navigation named Pages', () => {
    const { getByRole } = render(<PageBar menu={MENU} pageId="machine" />)
    const nav = within(getByRole('navigation', { name: 'Pages' }))
    const href = (name) => nav.getByRole('link', { name }).getAttribute('href')
    expect(href('Next: A day with the harness →')).toBe('#/docs/day')
    expect(href('← What a harness is')).toBe('#/docs/harness')
  })

  // The track is one course across its sections; every other part's bar stays inside the
  // page's section. Guides here: Install has two pages, then General's two.
  it('walks the track across sections, and other parts only within one', () => {
    const menu = {
      groups: [
        {
          id: 'understand',
          label: 'Understand',
          pages: [
            { id: 'harness', title: 'H', section: 'General' },
            { id: 'machine', title: 'M', section: 'On your machine' },
          ],
        },
        {
          id: 'guides',
          label: 'Guides',
          pages: [
            { id: 'quick', title: 'Quick start', section: 'Install' },
            { id: 'clone', title: 'From a clone', section: 'Install' },
            { id: 'verify', title: 'Verify', section: 'General' },
            { id: 'mcp', title: 'MCP', section: 'General' },
          ],
        },
      ],
    }
    const ids = (nav) => [nav.prev?.id ?? null, nav.next?.id ?? null]
    expect(ids(pageNav(menu, 'harness'))).toEqual([null, 'machine'])
    expect(ids(pageNav(menu, 'machine'))).toEqual(['harness', 'quick'])
    expect(ids(pageNav(menu, 'quick'))).toEqual([null, 'clone'])
    expect(ids(pageNav(menu, 'clone'))).toEqual(['quick', null])
    expect(ids(pageNav(menu, 'verify'))).toEqual([null, 'mcp'])
    expect(ids(pageNav(menu, 'nope'))).toEqual([null, null])
    expect(placeOf(menu, 'clone').section).toBe('Install')
    expect(placeOf(menu, 'clone').part.id).toBe('guides')
  })

  it('records a read page once, as a JSON array', () => {
    markSeen('harness')
    markSeen('harness')
    markSeen('day')
    expect(localStorage.getItem(SEEN_KEY)).toBe('["harness","day"]')
    expect(readSeen()).toEqual(['harness', 'day'])
  })

  it('reads garbage in storage as nothing read', () => {
    localStorage.setItem(SEEN_KEY, '{oops')
    expect(readSeen()).toEqual([])
  })

  // A private window or a full quota refuses the write; the page still opens, unrecorded.
  it('survives storage that refuses the write', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    try {
      expect(markSeen('harness')).toEqual(['harness'])
    } finally {
      spy.mockRestore()
    }
  })
})
