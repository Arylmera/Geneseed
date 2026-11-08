import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import Loadout from '../components/Loadout.jsx'

// The Loadout panel's rules list obeys the user-rules block's delivery state (spec 2026-11-08,
// D7/D8). On a host with no SubagentStart wiring (`no-event`: Bob, OpenCode) the server still
// lists the install's user rules, but the sub-agent never receives them: they render muted with
// the block's reason and are left out of "Rules it follows". The primary has no user-rules
// block (its rules arrive with the session files), so its user rules always count.
const ROOT = {
  id: 'root:preamble',
  label: 'Preamble',
  chars: 8000,
  source: 'root',
  loadedBy: 'host',
}
const RULES = [
  { kind: 'dictate', id: 'I', title: 'Arcana · Sealed Secrets', citedBySpec: false },
  { kind: 'dictate', id: 'II', title: 'Unus Actus · One Intent, One Act', citedBySpec: true },
  { kind: 'doctrine', id: 'craft.6', title: 'Ictus · Smallest Viable Diff', citedBySpec: false },
  ...['R1', 'R2', 'R3', 'R4'].map((id) => ({
    kind: 'user',
    id,
    title: `User rule ${id}`,
    layer: 'install',
    citedBySpec: false,
  })),
]
const adept = (delivery) => ({
  agent: 'explorer',
  host: 'bob',
  notCounted: ['host system prompt and tools'],
  blocks: [
    ROOT,
    {
      id: 'user-rules',
      label: 'user rules',
      delivery,
      chars: 0,
      source: 'user-rules',
      loadedBy: 'subagent-hook',
    },
    { id: 'spec', label: 'explorer spec', chars: 3100, source: 'spec', loadedBy: 'host' },
  ],
  rules: RULES,
})
const rulesSection = () => screen.getByRole('region', { name: 'Rules it follows' })

describe('Loadout rules and delivery', () => {
  it('leaves undelivered user rules out of the count, muted with the reason', () => {
    render(<Loadout loadout={adept('no-event')} />)
    const sec = rulesSection()
    expect(within(sec).getByText('Rules it follows · 3')).toBeTruthy()
    expect(within(sec).getByText(/not delivered on this host/)).toBeTruthy()
    // Muted: no longer a link to rules the agent follows.
    expect(within(sec).getByText('User rules').closest('a')).toBeNull()
  })

  it('says to re-emit when the install predates the wiring', () => {
    render(<Loadout loadout={adept('not-wired')} />)
    const sec = rulesSection()
    expect(within(sec).getByText('Rules it follows · 3')).toBeTruthy()
    expect(within(sec).getByText(/re-emit this install/)).toBeTruthy()
  })

  it('counts delivered user rules', () => {
    render(<Loadout loadout={adept('wired')} />)
    const sec = rulesSection()
    expect(within(sec).getByText('Rules it follows · 7')).toBeTruthy()
    expect(within(sec).queryByText(/not delivered|re-emit/)).toBeNull()
    expect(within(sec).getByText('User rules').closest('a').getAttribute('href')).toBe(
      '#/personal/rules',
    )
  })

  it("counts the primary's user rules: they come with the session files", () => {
    const primary = {
      agent: 'primary',
      host: 'bob',
      notCounted: [],
      blocks: [
        ROOT,
        {
          id: 'session-files',
          label: 'session files',
          chars: 5000,
          source: 'session',
          loadedBy: 'session-hook',
        },
      ],
      rules: RULES,
    }
    render(<Loadout loadout={primary} />)
    expect(within(rulesSection()).getByText('Rules it follows · 7')).toBeTruthy()
  })
})
