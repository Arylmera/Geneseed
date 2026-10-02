import React from 'react'
import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/router.js', () => ({ go: vi.fn() }))

import Track, { TrackBar, trackNav, markSeen, readSeen, SEEN_KEY } from '../pages/Docs/Track.jsx'
import { go } from '../lib/router.js'

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
  it('marks read steps done and the open one on', () => {
    const { container } = render(<Track menu={MENU} pageId="machine" seen={['harness']} />)
    const steps = [...container.querySelectorAll('.track-step')].map((b) => [
      b.className.replace('track-step', '').trim(),
      b.querySelector('.track-n').textContent,
    ])
    expect(steps).toEqual([
      ['done', '✓'],
      ['on', '2'],
      ['', '3'],
      ['', '4'],
    ])
    expect(container.querySelector('.track-prog').getAttribute('aria-valuenow')).toBe('1')
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

  it('navigates from the bar', () => {
    const { getByText } = render(<TrackBar menu={MENU} pageId="machine" />)
    fireEvent.click(getByText('Next: A day with the harness →'))
    expect(go).toHaveBeenCalledWith('#/docs/day')
    fireEvent.click(getByText('← What a harness is'))
    expect(go).toHaveBeenCalledWith('#/docs/harness')
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
})
