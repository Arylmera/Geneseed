import React from 'react'
import { render, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import MarkdownPage from '../pages/Docs/MarkdownPage.jsx'

// Two DOM passes MarkdownPage makes after the body lands. The install guide is a section of
// pages, one per host: on the Install hub the list item linking to the deployed emit's host page
// is outlined (claude-global -> install-claude-code), and on the OpenCode page the H2 of the
// emit's scope (opencode-global -> "Global (recommended)", opencode -> "Per repo"). And a
// blockquote opening on **You already know this:** becomes an analogy box.
const HUB = [
  '## Install paths, one per host',
  '',
  '- [OpenCode](#/docs/install-opencode): global or per repo.',
  '- [Claude Code](#/docs/install-claude-code): with hooks.',
  '- [IBM Bob](#/docs/install-bob): global or per repo.',
].join('\n')
const OPENCODE = '## Global (recommended)\n\nx\n\n## Per repo\n\ny'
const lit = (c) => [...c.querySelectorAll('.docs-here')].map((h) => h.textContent)

describe('MarkdownPage', () => {
  it("outlines the hub's link to the deployed emit's host page", () => {
    const { container } = render(
      <MarkdownPage page={{ id: 'install', body: HUB }} overview={{ emit: 'claude-global' }} />,
    )
    expect(lit(container)).toEqual(['Claude Code: with hooks.'])
  })

  it("outlines the scope's heading on the host page", () => {
    const g = render(
      <MarkdownPage
        page={{ id: 'install-opencode', body: OPENCODE }}
        overview={{ emit: 'opencode-global' }}
      />,
    )
    expect(lit(g.container)).toEqual(['Global (recommended)'])
    const p = render(
      <MarkdownPage
        page={{ id: 'install-opencode', body: OPENCODE }}
        overview={{ emit: 'opencode' }}
      />,
    )
    expect(lit(p.container)).toEqual(['Per repo'])
  })

  // The outline is a highlight, never a jump: the guide opens at its top like every page.
  it('does not scroll to the lit path on open', () => {
    const spy = vi.fn()
    const had = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = spy
    try {
      const { container } = render(
        <MarkdownPage page={{ id: 'install', body: HUB }} overview={{ emit: 'bob' }} />,
      )
      expect(lit(container)).toEqual(['IBM Bob: global or per repo.'])
      expect(spy).not.toHaveBeenCalled()
    } finally {
      Element.prototype.scrollIntoView = had
    }
  })

  it("outlines nothing for an unknown emit, or on another host's page", () => {
    const a = render(<MarkdownPage page={{ id: 'install', body: HUB }} overview={{}} />)
    expect(lit(a.container)).toEqual([])
    const b = render(
      <MarkdownPage page={{ id: 'install-opencode', body: OPENCODE }} overview={{ emit: 'bob' }} />,
    )
    expect(lit(b.container)).toEqual([])
    const c = render(<MarkdownPage page={{ id: 'other', body: HUB }} overview={{ emit: 'bob' }} />)
    expect(lit(c.container)).toEqual([])
  })

  it('boxes a "You already know this:" blockquote and leaves a plain one alone', () => {
    const body = '> **You already know this:** a pre-commit hook.\n\npara\n\n> just a quote'
    const { container } = render(<MarkdownPage page={{ id: 'p', body }} />)
    const quotes = [...container.querySelectorAll('blockquote')].map((q) => q.className)
    expect(quotes).toEqual(['analogy', ''])
  })

  // The shared PageHeader carries the title and the try-actions. Docs have no primary
  // action, so every button in the header is a ghost one (one filled action per view).
  it('heads the page with PageHeader, the try-actions as ghost buttons', () => {
    const onAction = vi.fn()
    const { container } = render(
      <MarkdownPage page={{ id: 'install', title: 'Install', body: HUB }} onAction={onAction} />,
    )
    expect(container.querySelector('.page-head h1.h').textContent).toBe('Install')
    const btns = [...container.querySelectorAll('.page-actions .btn')]
    expect(btns.map((b) => b.textContent)).toEqual(['Run doctor', 'Rebuild'])
    expect(container.querySelectorAll('.page-actions .btn:not(.ghost)').length).toBe(0)
    fireEvent.click(btns[1])
    expect(onAction).toHaveBeenCalledWith('build')
  })

  // The head reads like a book's: the section and the reading time (200 words a minute,
  // rounded up, never under one) as the eyebrow, the menu's description as the lede. A page
  // the menu does not place gets neither, and the page keeps its one h1.
  it('heads the page with its section, its reading time and its description', () => {
    const body = Array(401).fill('word').join(' ')
    const { container } = render(
      <MarkdownPage
        page={{ id: 'p', title: 'Footprint', body }}
        section="Configuration"
        description="Lean or full."
      />,
    )
    expect(container.querySelector('.page-head .eyebrow').textContent).toBe(
      'Configuration · 3 min read',
    )
    expect(container.querySelector('.page-head .sub').textContent).toBe('Lean or full.')
    expect(container.querySelectorAll('h1').length).toBe(1)
    const bare = render(<MarkdownPage page={{ id: 'q', title: 'Q', body: 'one' }} />)
    expect(bare.container.querySelector('.eyebrow')).toBeNull()
    expect(bare.container.querySelector('.sub')).toBeNull()
    const short = render(<MarkdownPage page={{ id: 'r', title: 'R', body: '' }} section="S" />)
    expect(short.container.querySelector('.eyebrow').textContent).toBe('S · 1 min read')
  })

  // Each code block gets a caption bar: its language when the fence names one, and a ghost
  // Copy button that writes the block's text (no trailing newline, so a paste does not run
  // it). Wrapped once even when the effect runs twice (StrictMode runs it twice on mount).
  it('captions each code block with its language and a Copy button', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    const had = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    try {
      const body = '```bash\ngeneseed setup\n```\n\n```\nplain\n```'
      const { container } = render(
        <React.StrictMode>
          <MarkdownPage page={{ id: 'p', body }} />
        </React.StrictMode>,
      )
      const figs = [...container.querySelectorAll('figure.docs-code')]
      expect(figs.length).toBe(2)
      expect(container.querySelectorAll('figure.docs-code figure').length).toBe(0)
      expect(figs.map((f) => f.querySelector(':scope > figcaption .mono')?.textContent)).toEqual([
        'bash',
        undefined,
      ])
      const btn = figs[0].querySelector('figcaption button')
      expect([btn.type, btn.className, btn.getAttribute('aria-label'), btn.textContent]).toEqual([
        'button',
        'btn ghost sm',
        'Copy command',
        'Copy',
      ])
      expect(figs[0].querySelector(':scope > pre')).toBeTruthy()
      await act(async () => fireEvent.click(btn))
      expect(writeText).toHaveBeenCalledWith('geneseed setup')
    } finally {
      if (had) Object.defineProperty(navigator, 'clipboard', had)
      else delete navigator.clipboard
    }
  })

  // Docs keeps one MarkdownPage across pages (no key), so the body is swapped under the
  // portalled buttons: the new block gets one button, and it copies the new text.
  it('re-captions a new body in place, one button copying the new block', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    const had = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { container, rerender } = render(
        <MarkdownPage page={{ id: 'a', body: '```\nold\n```' }} />,
      )
      rerender(<MarkdownPage page={{ id: 'b', body: '```\nnew\n```' }} />)
      const btns = container.querySelectorAll('figure.docs-code figcaption button')
      expect(btns.length).toBe(1)
      await act(async () => fireEvent.click(btns[0]))
      expect(writeText).toHaveBeenCalledWith('new')
      expect(err).not.toHaveBeenCalled()
    } finally {
      err.mockRestore()
      if (had) Object.defineProperty(navigator, 'clipboard', had)
      else delete navigator.clipboard
    }
  })

  it('copies nothing and throws nothing without a clipboard, or when it refuses', async () => {
    const had = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    try {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
      const page = { id: 'p', body: '```\nx\n```' }
      const first = render(<MarkdownPage page={page} />)
      let btn = first.container.querySelector('figure.docs-code button')
      await act(async () => fireEvent.click(btn))
      // The failure is said on the button, not swallowed.
      expect(btn.textContent).toBe('Copy failed')
      first.unmount()
      // A fresh page, so the refusal's "Copy failed" cannot be the first click's still showing.
      const writeText = vi.fn(() => Promise.reject(new Error('denied')))
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
      btn = render(<MarkdownPage page={page} />).container.querySelector('figure.docs-code button')
      expect(btn.textContent).toBe('Copy')
      await act(async () => fireEvent.click(btn))
      expect(writeText).toHaveBeenCalledWith('x')
      expect(btn.textContent).toBe('Copy failed')
    } finally {
      if (had) Object.defineProperty(navigator, 'clipboard', had)
      else delete navigator.clipboard
    }
  })
})
