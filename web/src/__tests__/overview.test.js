import { describe, it, expect } from 'vitest'
import {
  constitutionMix,
  healthTone,
  needsAttention,
  runBars,
  runKind,
  skillsByStage,
} from '../lib/overview.js'

// The Overview's derivations, as tables: payloads in, rows out, every expected value written
// out. LAWS is an OLDER server's catalog (eleven invariants, IX and XI retired in place), kept
// because a console can still be pointed at such an install. The payload shapes are the real endpoints' (/api/overview, /api/setup, /api/rules,
// /api/activity, /api/profile, /api/catalog/{skills,laws}).

const COUNTS = { laws: 11, ontology: 4, doctrines: { active: 5, total: 5, rules: 28 } }
const LAWS = {
  items: [
    { name: 'ont:telos', title: 'Telos', tier: 'ontology' },
    { name: 'IX', title: 'Rule IX — Porta Externa · External Gate (retired)', tier: 'invariant' },
    { name: 'X', title: 'Rule X — Voluntas Confirmata · Echo the Intent', tier: 'invariant' },
    {
      name: 'XI',
      title: 'Rule XI — Absentia Non Probat · Absence Is a Claim (retired)',
      tier: 'invariant',
    },
    {
      name: 'process.5',
      title: 'Doctrine process 5 — Consensus Ante Pulsum · Consent Before Push',
      tier: 'doctrine',
    },
    {
      name: 'process.1',
      title: 'Doctrine process 1 — Memoria Servanda · Persist Insight',
      tier: 'doctrine',
    },
  ],
}

describe('constitutionMix', () => {
  it('splits the invariants into active and retired once the catalog is in', () => {
    // 11 invariants, two of them retired (IX, XI): 9 in force, "+2 retired" beside them.
    expect(constitutionMix(COUNTS, LAWS, { rules: 3 })).toEqual([
      { key: 'ethos', label: 'Ethos', n: 4 },
      { key: 'invariants', label: 'Invariants', n: 9, note: '+2 retired' },
      { key: 'doctrines', label: 'Doctrines', n: 28, note: '5 of 5 packs' },
      { key: 'yours', label: 'Your rules', n: 3 },
    ])
  })

  it('says nothing about retirement when no invariant is retired', () => {
    // The shipped canon since 2026-09-30: nine laws, none retired — a retired rule is removed,
    // not kept, so '+0 retired' would describe a state the canon no longer has.
    const current = { items: LAWS.items.filter((i) => !/(retired)/.test(i.title)) }
    const [, inv] = constitutionMix({ ...COUNTS, laws: 9 }, current, null)
    expect(inv).toEqual({ key: 'invariants', label: 'Invariants', n: 9, note: '' })
  })

  it('claims no retired count before the catalog has loaded', () => {
    const [, inv] = constitutionMix(COUNTS, null, null)
    expect(inv).toEqual({ key: 'invariants', label: 'Invariants', n: 11, note: '' })
  })
})

describe('skillsByStage', () => {
  it('counts per class in class order, experimental apart, unknown classes as personal', () => {
    const items = [
      { klass: 'build', status: 'approved' },
      { klass: 'build', status: 'experimental' },
      { klass: 'build', status: 'experimental' },
      { klass: 'design', status: 'approved' },
      { klass: 'nonsense', status: 'personal' },
    ]
    expect(skillsByStage(items)).toEqual({
      rows: [
        { key: 'design', label: 'Design', ok: 1, exp: 0, n: 1 },
        { key: 'build', label: 'Build', ok: 1, exp: 2, n: 3 },
        { key: 'personal', label: 'Personal', ok: 1, exp: 0, n: 1 },
      ],
      total: 5,
      experimental: 2,
      max: 3,
    })
  })
})

describe('runBars', () => {
  it.each([
    ['update', 'update'],
    ['build-all', 'rebuild'],
    ['install', 'other'],
    ['build (imperial · opencode-global)', 'other'],
  ])('%s is a %s run', (action, kind) => expect(runKind(action)).toBe(kind))

  it('scales to the longest run, floors tiny ones, drops a running job', () => {
    const runs = [
      { id: 'a', action: 'update', status: 'done', duration: 2 },
      { id: 'b', action: 'build-all', status: 'failed', duration: 1 },
      { id: 'c', action: 'install', status: 'done', duration: 0.05 },
      { id: 'd', action: 'doctor', status: 'running' },
    ]
    const { bars, ok, longest } = runBars(runs)
    expect(bars.map((b) => [b.id, b.kind, b.ok, b.h])).toEqual([
      ['a', 'update', true, 1],
      ['b', 'rebuild', false, 0.5],
      // 0.05 / 2 = 0.025, floored to 0.06 so it is still a visible bar.
      ['c', 'other', true, 0.06],
    ])
    expect([ok, longest]).toEqual([2, 2])
  })

  it('keeps only the last n', () => {
    const runs = Array.from({ length: 25 }, (_, i) => ({
      id: String(i),
      action: 'install',
      status: 'done',
      duration: 1,
    }))
    const { bars } = runBars(runs)
    expect(bars.map((b) => b.id)).toEqual(Array.from({ length: 20 }, (_, i) => String(i + 5)))
  })
})

// The full set of inputs that raises every row, and what each row says.
const ALL = {
  overview: {
    doctor: { ok: false, problems: ['[global] AGENT.md missing', 'x'] },
    diff: { edited: 2, added: 1, missing: 0 },
  },
  setup: { facts: 0, gates: { asks: { 'process-1': 2, 'process-5': 4 }, total: 6 } },
  rules: { exists: true, stats: { rules: 0, max_rules: 15, tokens: 332, max_tokens: 1500 } },
  activity: { enabled: false },
  profile: { exists: true, seeded: true },
  skills: {
    items: [
      { klass: 'build', status: 'experimental' },
      { klass: 'harness', status: 'experimental' },
      { klass: 'build', status: 'experimental' },
      { klass: 'design', status: 'approved' },
    ],
  },
  laws: LAWS,
}

describe('needsAttention', () => {
  it('raises every row, most urgent first, each with where it points', () => {
    expect(needsAttention(ALL).map((r) => [r.tag, r.tone, r.title, r.detail, r.href])).toEqual([
      [
        'Doctor',
        'bad',
        'Doctor found 2 problems',
        '[global] AGENT.md missing',
        '#/installs/doctor',
      ],
      [
        'Drift',
        'warn',
        '3 files drifted from the source',
        '2 edited, 1 added, 0 missing',
        '#/installs/edits',
      ],
      [
        'Profile',
        'warn',
        'Profile is still the seeded template',
        'every section holds placeholder text',
        '#/personal/profile',
      ],
      ['Rules', '', 'No standing rules yet', '0 of 15 · 332 of 1500 tokens', '#/personal/rules'],
      // The top ask names its doctrine from the catalog: process-5 is Consent Before Push.
      [
        'Gates',
        '',
        'Consent Before Push asked 4 times',
        '4 of 6 gate asks',
        '#/item/law/process.5',
      ],
      // Most experimental class first: build 2, then harness 1.
      ['Skills', '', '3 skills still experimental', 'build 2, harness 1', '#/skills'],
      ['Memory', '', 'Memory holds no facts', 'MEMORY.md is an empty index', '#/section/memory'],
      ['Activity', '', 'Session tracking is off', 'no per-session trace is kept', '#/activity'],
    ])
  })

  it('says nothing when every input is healthy', () => {
    expect(
      needsAttention({
        overview: { doctor: { ok: true, problems: [] }, diff: { edited: 0, added: 0, missing: 0 } },
        setup: { facts: 3, gates: { asks: {}, total: 0 } },
        rules: { exists: true, stats: { rules: 2, max_rules: 15, tokens: 400, max_tokens: 1500 } },
        activity: { enabled: true },
        profile: { exists: true, seeded: false },
        skills: { items: [{ klass: 'build', status: 'approved' }] },
        laws: LAWS,
      }),
    ).toEqual([])
  })

  // A fetch that failed or has not landed is `null`: its row is simply not claimed.
  it('claims nothing it has not read', () => {
    expect(needsAttention({})).toEqual([])
    expect(needsAttention({ ...ALL, laws: null }).find((r) => r.tag === 'Gates').title).toBe(
      'process.5 asked 4 times',
    )
  })

  it('reads a missing user-rules.md as no rules row (the Rules tab says it is missing)', () => {
    expect(needsAttention({ rules: { exists: false, stats: {} } })).toEqual([])
  })
})

describe('healthTone', () => {
  it.each([
    [{ doctor: { ok: false, problems: ['x'] } }, null, 'bad'],
    [{ doctor: { ok: true }, diff: { edited: 1, added: 0, missing: 0 } }, null, 'warn'],
    [{ doctor: { ok: true } }, { installed_fp: 'a', source_fp: 'b' }, 'warn'],
    [
      { doctor: { ok: true }, diff: { edited: 0, added: 0, missing: 0 } },
      { installed_fp: 'a', source_fp: 'a' },
      'good',
    ],
  ])('%j + %j -> %s', (ov, setup, tone) => expect(healthTone(ov, setup)).toBe(tone))
})
