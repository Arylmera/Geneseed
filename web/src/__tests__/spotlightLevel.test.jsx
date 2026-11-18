import React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ViewLevelProvider } from '../hooks/useViewLevel.jsx'
import Spotlight from '../components/Spotlight.jsx'

// A row for a page the reader's level hides still opens (the router shows a banner), so the
// row names the level it needs instead of vanishing.
const index = [
  { kind: 'Pages', sortKey: -1, title: 'Loops', desc: '', hay: 'loops', route: '#/loops' },
  { kind: 'Pages', sortKey: -1, title: 'Kits', desc: '', hay: 'kits', route: '#/kits' },
  { kind: 'Pages', sortKey: -1, title: 'Library', desc: '', hay: 'library', route: '#/library' },
  { kind: 'Actions', sortKey: -2, title: 'Rebuild', desc: '', hay: 'rebuild' },
]

function renderAt(level) {
  localStorage.setItem('geneseed-view-level', level)
  return render(
    <ViewLevelProvider>
      <Spotlight
        query=""
        index={index}
        loading={false}
        error=""
        active={0}
        onActive={() => {}}
        onPick={() => {}}
      />
    </ViewLevelProvider>,
  )
}

const tagOf = (title) =>
  screen.getByText(title).closest('[data-spot-row]').querySelector('.tag')?.textContent ?? null

describe('Spotlight level tags', () => {
  beforeEach(() => {
    localStorage.clear()
    // jsdom has no scrollIntoView, which Spotlight calls to keep the active row in view.
    Element.prototype.scrollIntoView = () => {}
  })

  it('tags the rows above the level with the level they need', () => {
    renderAt('essentials')
    expect(tagOf('Loops')).toBe('Power')
    expect(tagOf('Kits')).toBe('Standard')
  })

  it('leaves a visible row and a row with no route untagged', () => {
    renderAt('essentials')
    expect(tagOf('Library')).toBeNull()
    expect(tagOf('Rebuild')).toBeNull()
  })

  it('tags only what is still above the level', () => {
    renderAt('standard')
    expect(tagOf('Loops')).toBe('Power')
    expect(tagOf('Kits')).toBeNull()
  })

  it('shows no tag at Power', () => {
    renderAt('power')
    expect(tagOf('Loops')).toBeNull()
  })
})
