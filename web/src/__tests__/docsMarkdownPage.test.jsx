import React from 'react'
import { render } from '@testing-library/react'
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
})
