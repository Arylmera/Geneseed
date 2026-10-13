import { describe, it, expect } from 'vitest'
import { afterEach, beforeEach, vi } from 'vitest'
import {
  costTotal,
  fleetVerdict,
  gateRows,
  ledgerNeeds,
  needsAttention,
  skillsByStage,
} from '../lib/overview.js'
import { applyAccent } from '../lib/accents.js'

// The Overview's derivations, as tables: payloads in, rows out, every expected value written
// out. LAWS is an OLDER server's catalog (eleven invariants, IX and XI retired in place), kept
// because a console can still be pointed at such an install. The payload shapes are the real endpoints' (/api/overview, /api/setup, /api/rules,
// /api/activity, /api/profile, /api/catalog/{skills,laws}).

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

// ---- the Ledger (/api/fleet, /api/usage, /api/gates) ----
// One fleet that raises every per-install problem: opencode is behind and has 3 hand-edited
// files, claude is in step and clean, a bob project cannot be drift-checked (drift null), and
// openclaude is disabled. The clock is pinned so "built 6d ago" is a written-out value.
const NOW = Date.parse('2026-10-13T12:00:00Z')
const FLEET = {
  source_fp: 'abc',
  doctor: { ok: true, problems: [] },
  installs: [
    {
      id: 'oc',
      host: 'opencode',
      scope: 'global',
      state: 'active',
      verdict: 'behind',
      diffable: true,
      drift: { edited: 2, added: 1, missing: 0 },
      built_epoch: NOW / 1000 - 6 * 86400,
      cost: { carrier: 30000, skills: 12000, agents: 4000, context: 0, ceiling: 38890 },
    },
    {
      id: 'cl',
      host: 'claude',
      scope: 'global',
      state: 'active',
      verdict: 'synced',
      diffable: true,
      drift: { edited: 0, added: 0, missing: 0 },
      built_epoch: NOW / 1000,
      cost: null,
    },
    {
      id: 'bob',
      host: 'bob',
      scope: 'project',
      state: 'active',
      verdict: 'synced',
      diffable: false,
      drift: null,
      built_epoch: null,
      cost: null,
    },
    { id: 'ocl', host: 'openclaude', scope: 'global', state: 'disabled' },
  ],
}

describe('fleetVerdict', () => {
  it('warns on a behind or hand-edited install and counts what it read', () => {
    expect(fleetVerdict(FLEET)).toEqual({
      tone: 'warn',
      head: 'Harness needs a look.',
      facts: [
        '3 active installs, 1 disabled',
        'doctor clean',
        '1 install behind source',
        '3 files hand-edited',
      ],
    })
  })
  it('is bad when the doctor failed, whatever the installs say', () => {
    const v = fleetVerdict({ ...FLEET, doctor: { ok: false, problems: ['x', 'y'] } })
    expect([v.tone, v.facts[1]]).toEqual(['bad', 'doctor found 2 problems'])
  })
  it('is healthy for one clean install, and an unreadable marker alone does not warn', () => {
    const one = {
      doctor: { ok: true, problems: [] },
      installs: [{ ...FLEET.installs[1], verdict: 'unknown' }],
    }
    expect(fleetVerdict(one)).toEqual({
      tone: 'good',
      head: 'Harness healthy.',
      facts: ['1 active install', 'doctor clean', 'all in step with source', 'no hand edits'],
    })
  })
})

describe('ledgerNeeds', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW }))
  afterEach(() => vi.useRealTimers())
  it('lists per-install problems first, then the older nudges as suggestions', () => {
    const rows = ledgerNeeds({ fleet: FLEET, usage: null, ...ALL, overview: { ...ALL.overview } })
    expect(rows.slice(0, 2)).toEqual([
      {
        id: 'behind:oc',
        tag: 'Behind',
        tone: 'warn',
        title: 'opencode · global is behind its source',
        detail: 'built 6d ago',
        where: 'opencode',
        verb: 'Rebuild',
        act: 'build-all',
      },
      {
        id: 'drift:oc',
        tag: 'Drift',
        tone: 'warn',
        title: 'opencode · global: 3 files edited by hand',
        detail: '2 edited, 1 added, 0 missing',
        where: 'installs/edits',
        verb: 'Review',
        href: '#/installs/edits',
      },
    ])
    // The single-install doctor and drift rows are NOT repeated: the fleet says them per install.
    expect(rows.map((r) => r.id)).not.toContain('doctor')
    expect(rows.map((r) => r.id)).not.toContain('drift')
    expect(rows.slice(2).every((r) => r.sugg)).toBe(true)
  })
  it('raises the doctor from the fleet as the first problem', () => {
    const rows = ledgerNeeds({
      fleet: { ...FLEET, doctor: { ok: false, problems: ['shim moved'] } },
    })
    expect(rows[0]).toMatchObject({ id: 'doctor', tone: 'bad', detail: 'shim moved' })
  })
  it('holds the never-fired row back until 30 days are counted', () => {
    const never = [
      { kind: 'skill', name: 'a' },
      { kind: 'skill', name: 'b' },
      { kind: 'agent', name: 'c' },
    ]
    const ids = (u) => ledgerNeeds({ fleet: null, usage: u }).map((r) => r.id)
    expect(ids({ days_counted: 29, never })).toEqual([])
    expect(ledgerNeeds({ fleet: null, usage: { days_counted: 30, never } })).toEqual([
      {
        id: 'usage',
        tag: 'Usage',
        tone: '',
        sugg: true,
        title: '2 skills never fired in 30 days',
        detail: '1 agent too',
        where: 'library/skills',
        verb: 'Triage',
        href: '#/skills',
      },
    ])
  })
})

describe('costTotal and gateRows', () => {
  it('sums the four parts, and an unmeasured install costs nothing', () => {
    expect(costTotal(FLEET.installs[0].cost)).toBe(46000)
    expect(costTotal(null)).toBe(0)
  })
  it('names a gate by its principle when the catalog has it, else by its address', () => {
    const rows = gateRows(
      {
        rules: [
          { rule: 'process-1', n: 2, per_day: [] },
          { rule: 'wiki', n: 1, per_day: [] },
        ],
      },
      LAWS,
    )
    expect(rows.map((r) => r.name)).toEqual(['Persist Insight', 'Wiki guard'])
  })
})

describe('applyAccent', () => {
  // A yellow accent equals the warning colour, so the warning moves to orange under it, and
  // only under it: switching to another accent drops the override.
  it('moves --warn off a yellow accent and back', () => {
    const el = document.createElement('div')
    applyAccent(el, 'yellow', 'dark')
    expect(el.style.getPropertyValue('--warn')).toBe('#F08A4B')
    applyAccent(el, 'yellow', 'light')
    expect(el.style.getPropertyValue('--warn')).toBe('#B4521C')
    applyAccent(el, 'cyan', 'dark')
    expect(el.style.getPropertyValue('--warn')).toBe('')
  })
})
