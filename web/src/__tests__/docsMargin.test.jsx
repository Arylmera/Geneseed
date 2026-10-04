import React from 'react'
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import Margin, { glossaryHits } from '../pages/Docs/Margin.jsx'

// The Handbook margin: the page's H2/H3 outline, then a card per glossary term the page
// uses. A term matches as a whole word, any case, with a plural "s" allowed — so "Skills"
// matches the row for `skill`, while "Webhooks" does not match `hook`.
const row = (t) => ({ label: t, neutral: t, themed: t, desc: `${t} meaning` })
const ROWS = [row('hook'), row('skill'), row('agent')]
const texts = (c, sel) => [...c.querySelectorAll(sel)].map((n) => n.textContent)

describe('Margin', () => {
  it('outlines the headings and cards the terms the body uses, in glossary order', () => {
    const { container } = render(
      <Margin body={'## Hooks\nA hook runs. Skills too.'} glossaryRows={ROWS} />,
    )
    expect(texts(container, '.docs-toc a')).toEqual(['Hooks'])
    expect(texts(container, '.docs-gloss-card b')).toEqual(['hook', 'skill'])
  })

  it('links each heading to the id the markdown renderer gives it', () => {
    const { container } = render(<Margin body={'## Two words\n### Sub part'} glossaryRows={[]} />)
    const hrefs = [...container.querySelectorAll('.docs-toc a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['#two-words', '#sub-part'])
  })

  // The outline prints what the reader sees in the heading, not its markdown source.
  it('strips inline markdown from the outline titles', () => {
    const body = [
      '## The `geneseed` CLI',
      '## **Bold** and *italic*',
      '## See [the guide](https://example.com/g)',
      '### A [[skill]] and snake_case',
    ].join('\n')
    const { container } = render(<Margin body={body} glossaryRows={[]} />)
    expect(texts(container, '.docs-toc a')).toEqual([
      'The geneseed CLI',
      'Bold and italic',
      'See the guide',
      'A skill and snake_case',
    ])
  })

  it('needs a whole word: Webhooks is not a hook', () => {
    expect(glossaryHits('Webhooks fire.', ROWS)).toEqual([])
  })

  // A page written in neutral words still cards a row whose deployed theme renames it.
  it('matches the neutral word when the theme renames it', () => {
    const themed = { label: 'Skill', neutral: 'skill', themed: 'litany', desc: 'd' }
    expect(glossaryHits('Call a skill.', [themed]).map((r) => r.themed)).toEqual(['litany'])
  })

  it('stops at five cards', () => {
    const many = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'].map(row)
    expect(glossaryHits('a1 b2 c3 d4 e5 f6', many).map((r) => r.label)).toEqual([
      'a1',
      'b2',
      'c3',
      'd4',
      'e5',
    ])
  })

  it('renders nothing for a page with no headings and no terms', () => {
    const { container } = render(<Margin body="plain" glossaryRows={ROWS} />)
    expect(container.innerHTML).toBe('')
  })
})
