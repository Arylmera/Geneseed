import { describe, it, expect } from 'vitest'
import { HOSTS, hostInfo, removeLayer } from '../lib/hosts.js'
import { HARNESSES, docsHostOf } from '../hooks/useHarness.js'

// lib/hosts.js replaced four ternary chains over host ids. These rows are the chains'
// answers, written out, so the table cannot quietly disagree with what they said.
describe('host facts', () => {
  it('lists the five hosts in deploy-picker order', () => {
    expect(HOSTS.map((h) => [h.id, h.label])).toEqual([
      ['opencode', 'OpenCode'],
      ['claude', 'Claude Code'],
      ['bob', 'BOB (IBM)'],
      ['copilot', 'GitHub Copilot'],
      ['openclaude', 'OpenClaude'],
    ])
  })

  it.each([
    ['claude', 'project', '.claude/ + the CLAUDE.md block'],
    ['bob', 'project', '.bob/ + the AGENTS.md block'],
    ['copilot', 'project', ".github's Geneseed agents/skills + the AGENTS.md block"],
    ['openclaude', 'project', '.openclaude/ + its CLAUDE.md block'],
    ['opencode', 'project', '.opencode/ + AGENT.md + the bundle'],
    ['claude', 'global', "~/.claude's agents/skills + the CLAUDE.md block + settings hooks"],
    ['bob', 'global', "~/.bob's agents/skills + the AGENTS.md block + settings hooks"],
    ['copilot', 'global', "~/.copilot's agents/skills + the copilot-instructions.md block"],
    [
      'openclaude',
      'global',
      "~/.openclaude's agents/skills + the CLAUDE.md block + settings hooks",
    ],
    [
      'opencode',
      'global',
      "~/.config/opencode's AGENT.md, agents, skills, plugins + the opencode.json entry",
    ],
    // An unknown host fell through every chain to OpenCode's answer, and still does.
    ['mystery', 'project', '.opencode/ + AGENT.md + the bundle'],
  ])('remove on %s · %s deletes %s', (host, scope, layer) => {
    expect(removeLayer(host, scope)).toBe(layer)
  })

  it('names what a per-repo deploy adds', () => {
    expect(HOSTS.map((h) => hostInfo(h.id).deployAdds)).toEqual([
      '.opencode/ + AGENT.md',
      '.claude/ + CLAUDE.md',
      '.bob/ + AGENTS.md',
      '.github/ + AGENTS.md',
      '.openclaude/ + its CLAUDE.md',
    ])
  })
})

describe('docs host', () => {
  it('offers the two docs families', () => {
    expect(HARNESSES).toEqual([
      { id: 'opencode', label: 'OpenCode' },
      { id: 'claude', label: 'Claude Code' },
    ])
  })

  // Bob, Copilot and OpenClaude emit through the Claude engine and read Claude's pages.
  it.each([
    ['opencode', 'opencode'],
    ['opencode-global', 'opencode'],
    ['claude', 'claude'],
    ['claude-global', 'claude'],
    ['bob-global', 'claude'],
    ['copilot', 'claude'],
    ['openclaude-global', 'claude'],
    ['files', 'opencode'],
    [undefined, 'opencode'],
  ])('emit %s reads the %s docs', (emit, docs) => {
    expect(docsHostOf(emit)).toBe(docs)
  })
})
