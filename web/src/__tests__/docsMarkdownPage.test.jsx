import React from 'react'
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import MarkdownPage from '../pages/Docs/MarkdownPage.jsx'

// Two DOM passes MarkdownPage makes after the body lands: on the install guide the H3 for
// the deployed emit is outlined (matched by slug; claude-global reads "Claude Code"), and a
// blockquote opening on **You already know this:** becomes an analogy box.
const INSTALL = '### OpenCode, per-repo\n\nx\n\n### Claude Code\n\ny\n\n### Bob\n\nz'
const lit = (c) => [...c.querySelectorAll('.docs-here')].map((h) => h.textContent)

describe('MarkdownPage', () => {
  it('outlines the install path of the deployed emit', () => {
    const { container } = render(
      <MarkdownPage page={{ id: 'install', body: INSTALL }} overview={{ emit: 'claude-global' }} />,
    )
    expect(lit(container)).toEqual(['Claude Code'])
  })

  it('outlines nothing for an emit with no heading, or on another page', () => {
    const a = render(<MarkdownPage page={{ id: 'install', body: INSTALL }} overview={{}} />)
    expect(lit(a.container)).toEqual([])
    const b = render(
      <MarkdownPage page={{ id: 'other', body: INSTALL }} overview={{ emit: 'bob' }} />,
    )
    expect(lit(b.container)).toEqual([])
  })

  it('boxes a "You already know this:" blockquote and leaves a plain one alone', () => {
    const body = '> **You already know this:** a pre-commit hook.\n\npara\n\n> just a quote'
    const { container } = render(<MarkdownPage page={{ id: 'p', body }} />)
    const quotes = [...container.querySelectorAll('blockquote')].map((q) => q.className)
    expect(quotes).toEqual(['analogy', ''])
  })
})
