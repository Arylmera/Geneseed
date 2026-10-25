import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import * as C from '../lib/constitution.js'
const { GATE_SWITCH, HOOK_GATED, enforcedBy, gateAddress, parseRuleTitle } = C
// The server's own tables, imported rather than regex-read out of their source. Their import
// closure is relative and `node:` modules only (no bare specifier, so web's own `npm ci` is
// enough) and loads cleanly under vitest's jsdom environment.
import { HOOK_PINNED } from '../../../js/inspect/checks-constitution.mjs'
import { GATE_SWITCHES } from '../../../js/build/source.mjs'

// A catalog title -> { latin, name, retired }. The prefix (`Rule IV — `, `Doctrine craft 1 — `)
// is the address, which the table prints in its own column; the Latin half is the voice's,
// and a voice without one leaves `latin` empty rather than repeating the name.
const TITLES = [
  [
    'Rule IV — Deletio Deliberata · Deletion Is Deliberate',
    { latin: 'Deletio Deliberata', name: 'Deletion Is Deliberate', retired: false },
  ],
  [
    'Rule XI — Absentia Non Probat · Absence Is a Claim (retired)',
    { latin: 'Absentia Non Probat', name: 'Absence Is a Claim', retired: true },
  ],
  [
    'Doctrine craft 1 — Machina Pro Labore · Automate Repetition',
    { latin: 'Machina Pro Labore', name: 'Automate Repetition', retired: false },
  ],
  // The neutral voice has no Latin: the whole remainder is the name.
  ['Rule I — Sealed Secrets', { latin: '', name: 'Sealed Secrets', retired: false }],
  // An ethos section's title has no prefix at all.
  ['Telos', { latin: '', name: 'Telos', retired: false }],
  // A hyphen stands in for the dash on an older payload.
  ['Rule II - One Intent, One Act', { latin: '', name: 'One Intent, One Act', retired: false }],
]

describe('parseRuleTitle', () => {
  it.each(TITLES)('%s', (title, expected) => expect(parseRuleTitle(title)).toEqual(expected))
})

// The gate ledger keys by gate id; the catalog by address.
describe('gateAddress', () => {
  it.each([
    ['law-1', 'I'],
    ['law-4', 'IV'],
    ['law-9', 'IX'],
    ['law-11', 'XI'],
    ['process-5', 'process.5'],
    ['rigor-2', 'rigor.2'],
    ['odd', 'odd'],
  ])('%s -> %s', (key, addr) => expect(gateAddress(key)).toBe(addr))
})

describe('HOOK_GATED', () => {
  // Law III joined in #293: the Stop-hook done gate blocks and records `law-3`.
  it('names the seven rules a hook enforces, and nothing else reads as a gate', () => {
    expect([...HOOK_GATED].sort()).toEqual([
      'I',
      'III',
      'IV',
      'ops.2',
      'process.1',
      'process.5',
      'rigor.5',
    ])
    expect(enforcedBy('III')).toBe('Hook gate')
    expect(enforcedBy('II')).toBe('Instruction')
  })

  // The set is transcribed from the doctor's HOOK_PINNED, the one list of every hook-gated
  // rule — the tool-boundary `ask()` gates in js/hosts/hooks.mjs and the done gate in
  // js/hosts/hooks-done.mjs alike. Its labels (`process 5`) become addresses (`process.5`): a
  // rule pinned or unpinned there fails here until the Constitution's "Enforced by" column agrees.
  it('matches the doctor HOOK_PINNED in js/inspect/checks-constitution.mjs', () => {
    const labels = Object.values(HOOK_PINNED).map((l) => l.replace(' ', '.'))
    expect(labels.length).toBeGreaterThan(0)
    expect(new Set(labels)).toEqual(HOOK_GATED)
  })

  // GATE_SWITCH is transcribed from the server's GATE_SWITCHES (js/build/source.mjs), the one
  // table of switchable gates: a gate added or renamed there fails here until the
  // Constitution's toggles agree.
  it('matches GATE_SWITCHES in js/build/source.mjs', () => {
    const rows = GATE_SWITCHES.map((g) => [g.law, g.key])
    expect(rows.length).toBeGreaterThan(0)
    expect(Object.fromEntries(rows)).toEqual(
      Object.fromEntries(Object.entries(GATE_SWITCH).map(([law, g]) => [law, g.key])),
    )
    // A switch on a law no hook gates would toggle nothing.
    for (const law of Object.keys(GATE_SWITCH)) expect(HOOK_GATED.has(law)).toBe(true)
  })
})

// The Constitution's tier strip ranks the tiers. The rank is not the page's to choose: it is the
// Precedence table in src/AGENT.md.tmpl, which every install's AGENT.md carries. The page once
// numbered Ethos first and your own rules last, the reverse of the table, and no test noticed.
// So PRECEDENCE is checked against the REAL template, row by row, order and rule line included.
describe('PRECEDENCE', () => {
  // `process.cwd()` is web/ (agentGlyph.test.jsx does the same): under jsdom, import.meta.url
  // is not a file: URL, so `new URL(..., import.meta.url)` cannot be read.
  const tmpl = readFileSync(resolve(process.cwd(), '../src/AGENT.md.tmpl'), 'utf8')

  // `key` is the page's own name for a tier, so the template cannot carry it: the gate compares
  // what the table does say, the source of each rank and its rule against the rank above.
  const authored = () => C.PRECEDENCE.map(({ source, against }) => ({ source, against }))

  it('matches rows 1-4 of the Precedence table in src/AGENT.md.tmpl', () => {
    expect(C.parsePrecedence(tmpl).slice(0, 4)).toEqual(authored())
  })

  it('matches rows 5-6 with PRECEDENCE_INFORM', () => {
    const tail = C.PRECEDENCE_INFORM.map(({ source, against }) => ({ source, against }))
    expect(C.parsePrecedence(tmpl).slice(4)).toEqual(tail)
  })

  // The gate must fail both ways: a table whose rows are swapped no longer equals the constant.
  it('no longer matches a table with two rows swapped', () => {
    const swapped = tmpl.replace(
      /(\| 1 \|[^\n]*\n)(\| 2 \|[^\n]*\n)/,
      (m, one, two) => two.replace('| 2 |', '| 1 |') + one.replace('| 1 |', '| 2 |'),
    )
    expect(swapped).not.toBe(tmpl)
    expect(C.parsePrecedence(swapped).slice(0, 4)).not.toEqual(authored())
  })
})
