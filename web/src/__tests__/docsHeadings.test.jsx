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

  // Many sources start at ###. The title is the H1, so the page must go H1 then H2, each level
  // moved by one step: the order stays, the skip goes.
  it('starts a page at H2 whatever level its source starts at', () => {
    const body = '### First\n\na\n\n#### Under it\n\nb\n\n### Second'
    const { container } = render(<MarkdownPage page={{ id: 'p', title: 'T', body }} />)
    const heads = [...container.querySelectorAll('h1, h2, h3, h4')].map((h) => [
      h.tagName,
      h.textContent,
    ])
    expect(heads).toEqual([
      ['H1', 'T'],
      ['H2', 'First'],
      ['H3', 'Under it'],
      ['H2', 'Second'],
    ])
  })

  it('leaves a page that starts at H2 as it is', () => {
    const { container } = render(<MarkdownPage page={{ id: 'p', body: '## A\n\n### B' }} />)
    expect(
      [...container.querySelectorAll('.markdown h2, .markdown h3')].map((h) => h.tagName),
    ).toEqual(['H2', 'H3'])
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
