import React from 'react'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import AgentGlyph, { GLYPHS } from '../components/AgentGlyph.jsx'

// The glyphs are console decoration. Two things are pinned: every shipped agent has its own
// drawing (a new agent without one still renders, on the generic glyph, and this row names
// it), and no glyph ever reaches the harness, whose agent files carry no SVG at all.
// vitest runs from web/, so the harness's agents are one level up.
const AGENTS_DIR = resolve(process.cwd(), '../src/agents') + '/'
const shipped = readdirSync(AGENTS_DIR)
  .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
  .map((f) => f.replace(/\.md$/, ''))
  .sort()

describe('AgentGlyph', () => {
  it('draws every shipped agent', () => {
    expect(shipped.length).toBeGreaterThan(0)
    expect(shipped.filter((a) => !GLYPHS[a])).toEqual([])
  })

  it('keeps the drawings out of the harness', () => {
    for (const a of shipped)
      expect(readFileSync(`${AGENTS_DIR}${a}.md`, 'utf8')).not.toMatch(/<svg/i)
  })

  it('falls back to the generic glyph for an agent it does not know', () => {
    const { container } = render(<AgentGlyph name="not-an-agent" />)
    expect(container.querySelector('svg.agent-glyph')).toBeTruthy()
    expect(container.querySelector('svg').getAttribute('aria-hidden')).toBe('true')
  })
})
