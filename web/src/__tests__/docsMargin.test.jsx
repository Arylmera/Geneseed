import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import Margin, { glossaryHits } from '../pages/Docs/Margin.jsx'
import MarkdownPage from '../pages/Docs/MarkdownPage.jsx'

vi.mock('../lib/router.js', () => ({ go: vi.fn() }))
import CliPage from '../pages/Docs/CliPage.jsx'

// The Handbook margin: the page's H2/H3 outline, then a card per glossary term the page
// uses. A term matches as a whole word, any case, with a plural "s" allowed — so "Skills"
// matches the row for `skill`, while "Webhooks" does not match `hook`.
const row = (t) => ({ label: t, neutral: t, themed: t, desc: `${t} meaning` })
const ROWS = [row('hook'), row('skill'), row('agent')]
const texts = (c, sel) => [...c.querySelectorAll(sel)].map((n) => n.textContent)

describe('Margin', () => {
  it('outlines the headings and cards the terms the body uses, in glossary order', () => {
    const { container } = render(
      <Margin page={{ body: '## Hooks\nA hook runs. Skills too.' }} glossaryRows={ROWS} />,
    )
    expect(texts(container, '.docs-toc a')).toEqual(['Hooks'])
    expect(texts(container, '.docs-gloss-card b')).toEqual(['hook', 'skill'])
  })

  // That each entry lands on an id the rendered page carries is docsHeadings.test.jsx: it
  // renders the page beside the margin, which a margin alone cannot show.

  // The outline prints what the reader sees in the heading, not its markdown source — a
  // wikilink as its resolved link's text.
  it('strips inline markdown from the outline titles', () => {
    const body = [
      '## The `geneseed` CLI',
      '## **Bold** and *italic*',
      '## See [the guide](https://example.com/g)',
      '### A [[skill]] and snake_case',
    ].join('\n')
    const links = [{ label: 'skill', type: 'skill', name: 'skill' }]
    const { container } = render(<Margin page={{ body, links }} glossaryRows={[]} />)
    expect(texts(container, '.docs-toc a')).toEqual([
      'The geneseed CLI',
      'Bold and italic',
      'See the guide',
      'A skill and snake_case',
    ])
  })

  // A CLI page has no markdown body: its outline is its commands, each landing on the id
  // CliPage gives that command's heading.
  it('outlines a CLI page by its commands, on the ids the page carries', () => {
    const page = { kind: 'cli', title: 'CLI', commands: [{ name: 'build' }, { name: 'doctor' }] }
    const { container } = render(
      <>
        <CliPage page={page} />
        <Margin page={page} glossaryRows={[]} />
      </>,
    )
    const hrefs = [...container.querySelectorAll('.docs-toc a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['#cmd-build', '#cmd-doctor'])
    expect(screen.getByRole('heading', { level: 2, name: 'build' }).id).toBe('cmd-build')
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

  // Scroll spy: the current entry is the last heading whose top has reached ~96px from the
  // viewport top; none before the first one does. Heard on any scroll in the page, the app
  // shell's `main#main` included (a capture listener: scroll does not bubble).
  it('marks the heading being read as the current outline entry', () => {
    const page = { body: '## One\n\na\n\n## Two\n\nb\n\n## Three\n\nc' }
    const { container } = render(
      <>
        <MarkdownPage page={page} />
        <Margin page={page} glossaryRows={[]} />
      </>,
    )
    const tops = { one: 300, two: 500, three: 700 }
    for (const id of Object.keys(tops)) {
      document.getElementById(id).getBoundingClientRect = () => ({ top: tops[id] })
    }
    const current = () =>
      [...container.querySelectorAll('.docs-toc a[aria-current="location"]')].map(
        (a) => a.textContent,
      )
    act(() => fireEvent.scroll(document))
    expect(current()).toEqual([])
    Object.assign(tops, { one: -200, two: 96, three: 300 })
    const main = document.createElement('main')
    main.id = 'main'
    document.body.appendChild(main)
    try {
      act(() => fireEvent.scroll(main))
      expect(current()).toEqual(['Two'])
    } finally {
      main.remove()
    }
    Object.assign(tops, { one: -600, two: -400, three: 20 })
    act(() => fireEvent.scroll(document))
    expect(current()).toEqual(['Three'])
  })

  // DC-8: a jump that only scrolls leaves focus in the outline, so the next Tab goes back to
  // the outline, not on into the section. And the scroll obeys reduced motion: jsdom has no
  // matchMedia, which motionOK() reads as "reduce", so the jump is instant.
  it('moves focus to the heading it jumps to, without smooth scroll under reduced motion', () => {
    const page = { body: '## One\n\na\n\n## Two\n\nb' }
    render(
      <>
        <MarkdownPage page={page} />
        <Margin page={page} glossaryRows={[]} />
      </>,
    )
    const two = document.getElementById('two')
    two.scrollIntoView = vi.fn()
    fireEvent.click(screen.getByRole('link', { name: 'Two' }))
    expect(two.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto' })
    expect(document.activeElement).toBe(two)
  })

  it('renders nothing for a page with no headings and no terms', () => {
    const { container } = render(<Margin page={{ body: 'plain' }} glossaryRows={ROWS} />)
    expect(container.innerHTML).toBe('')
  })
})
