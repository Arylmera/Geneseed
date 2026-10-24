import React from 'react'
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import MarkdownPage from '../pages/Docs/MarkdownPage.jsx'
import MapPage from '../pages/Docs/MapPage.jsx'
import Margin from '../pages/Docs/Margin.jsx'

// The outline in the margin and the headings in the page must agree: every "On this page" link
// lands on a heading id the page carries. Three headings break a source-side slug that the page
// does not share — a link in the heading (the source has the URL, the page only the text), an
// entity (`&amp;` is `&` on the page) and a repeated title (two headings, two ids).
const BODY = [
  '## See [the guide](https://example.com/g)',
  'a',
  '## Q&amp;A',
  'b',
  '## Setup',
  'c',
  '### Setup',
  'd',
].join('\n')

const MAP_BODY = [
  '## Before',
  '| Piece | What it does for you | Kind | Cost | Turn it off |',
  '|---|---|---|---|---|',
  '| x | y | asked | z | w |',
  '',
  '## Before',
  'after',
].join('\n')
const MAP_ROWS = [{ piece: 'x', does: 'y', kind: 'asked', cost: 'z', off: 'w' }]

function outlineLands(pageEl, page) {
  const { container } = render(<Margin page={page} glossaryRows={[]} />)
  const hrefs = [...container.querySelectorAll('.docs-toc a')].map((a) => a.getAttribute('href'))
  const ids = [...pageEl.querySelectorAll('.markdown [id]')].map((n) => n.id)
  return { hrefs, ids }
}

describe('Docs headings', () => {
  it('links every outline entry to a heading id the page carries, duplicates apart', () => {
    const page = { id: 'p', body: BODY }
    const { container } = render(<MarkdownPage page={page} />)
    const { hrefs, ids } = outlineLands(container, page)
    expect(hrefs).toEqual(['#see-the-guide', '#qa', '#setup', '#setup-2'])
    expect(hrefs.map((h) => h.slice(1)).filter((h) => !ids.includes(h))).toEqual([])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives a map page the same ids in its prose as its outline', () => {
    const page = { id: 'm', kind: 'map', body: MAP_BODY, rows: MAP_ROWS }
    const { container } = render(<MapPage page={page} />)
    const { hrefs, ids } = outlineLands(container, page)
    expect(hrefs).toEqual(['#before', '#before-2'])
    expect(ids).toEqual(['before', 'before-2'])
  })

  // A wide table scrolls inside its own box, reachable by keyboard, instead of the page.
  it('wraps each table in a focusable scroll region', () => {
    const body = '| a | b |\n|---|---|\n| 1 | 2 |'
    const { container } = render(<MarkdownPage page={{ id: 'p', body }} />)
    const box = container.querySelector('.markdown table')?.parentElement
    expect(box?.className).toBe('table-scroll')
    expect([box.getAttribute('tabindex'), box.getAttribute('role')]).toEqual(['0', 'region'])
    expect(box.getAttribute('aria-label')).toBe('Table')
  })
})
