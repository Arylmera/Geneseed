import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { HOOK_GATED, enforcedBy, gateAddress, parseRuleTitle } from '../lib/constitution.js'

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
  it('names the four rules a hook enforces, and nothing else reads as a gate', () => {
    expect([...HOOK_GATED].sort()).toEqual(['I', 'IV', 'process.1', 'process.5'])
    expect(enforcedBy('IV')).toBe('Hook gate')
    expect(enforcedBy('III')).toBe('Instruction')
  })

  // The set is transcribed from js/hosts/hooks.mjs, where every gate is an
  // `ask(args, '<gate>', '<id>', ...)` call. Read the ids back out of that file: a gate
  // added or dropped there fails here until the Constitution's "Enforced by" column agrees.
  it('matches the ask() ids in js/hosts/hooks.mjs', () => {
    const src = readFileSync(
      // vitest runs from web/ (jsdom gives import.meta.url no file scheme).
      resolve(process.cwd(), '../js/hosts/hooks.mjs'),
      'utf8',
    )
    const ids = [...src.matchAll(/ask\(args, '[a-z-]+', '([a-z]+-\d+)'/g)].map((m) => m[1])
    expect(new Set(ids.map(gateAddress))).toEqual(HOOK_GATED)
  })
})
