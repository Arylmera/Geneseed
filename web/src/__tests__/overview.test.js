import { describe, it, expect } from 'vitest'
import { afterEach, beforeEach, vi } from 'vitest'
import {
  costTotal,
  fleetVerdict,
  gateRows,
  ledgerNeeds,
  needsAttention,
  needsRebuild,
  neverFired,
  sessionStartFigure,
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
        { key: 'personal', label: 'Custom', ok: 1, exp: 0, n: 1 },
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
  rules: { exists: true, stats: { rules: 0, tokens: 1332 } },
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
      ['Local edits', 'warn', '3 local edits', '2 edited, 1 added, 0 missing', '#/installs/edits'],
      [
        'Profile',
        'warn',
        'Profile is still the seeded template',
        'every section holds placeholder text',
        '#/personal/profile',
      ],
      [
        'Rules',
        '',
        'No standing rules yet',
        "≈1,332 tokens, the file's header alone",
        '#/personal/rules',
      ],
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
      ['Memory', '', 'Memory holds no facts', 'MEMORY.md is an empty index', '#/personal/memory'],
      ['Activity', '', 'Session tracking is off', 'no per-session trace is kept', '#/activity'],
    ])
  })

  it('says nothing when every input is healthy', () => {
    expect(
      needsAttention({
        overview: { doctor: { ok: true, problems: [] }, diff: { edited: 0, added: 0, missing: 0 } },
        setup: { facts: 3, gates: { asks: {}, total: 0 } },
        rules: { exists: true, stats: { rules: 2, tokens: 400 } },
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
      'Process rule 5 asked 4 times',
    )
  })

  // The ownership gate has no catalog item: its switch's label names it, and the link stays.
  it('names the ownership gate by its switch', () => {
    const row = needsAttention({
      ...ALL,
      setup: { gates: { asks: { ownership: 3 }, total: 3 } },
    }).find((r) => r.tag === 'Gates')
    expect(row.title).toBe('Ownership gate asked 3 times')
    expect(row.href).toBe('#/item/law/ownership')
  })

  it('reads a missing user-rules.md as no rules row (the Rules tab says it is missing)', () => {
    expect(needsAttention({ rules: { exists: false, stats: {} } })).toEqual([])
  })
})

// ---- the Ledger (/api/fleet, /api/usage, /api/gates) ----
// One fleet that raises every per-install problem: opencode is behind and has 3 local
// edits, claude is in sync and clean, a bob project cannot be drift-checked (drift null), and
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
      path: '/h/.config/opencode',
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
  it('warns on a behind install or local edits and counts what it read', () => {
    expect(fleetVerdict(FLEET)).toEqual({
      tone: 'warn',
      head: 'Installs need a look.',
      facts: [
        '3 active installs, 1 disabled',
        'doctor clean',
        '1 install behind source',
        '3 local edits',
      ],
    })
  })
  it('is bad when the doctor failed, whatever the installs say', () => {
    const v = fleetVerdict({ ...FLEET, doctor: { ok: false, problems: ['x', 'y'] } })
    expect([v.tone, v.facts[1]]).toEqual(['bad', 'doctor found 2 problems'])
  })
  // A cold daemon's fleet answers before its doctor: nothing vouches for the harness yet.
  it('claims no health while the doctor is still running', () => {
    const v = fleetVerdict({ installs: [], doctor: null })
    expect([v.tone, v.head, v.facts[1]]).toEqual([
      'unknown',
      'Checking the installs.',
      'doctor still running',
    ])
  })
  // `stale` files are unedited ones the install's source has moved past: a rebuild updates
  // them, so they read as "behind", never as local edits.
  it('says behind, not local edits, for an install whose only drift is stale', () => {
    const one = {
      doctor: { ok: true, problems: [] },
      installs: [
        { ...FLEET.installs[0], drift: { edited: 0, added: 0, missing: 0, linked: 0, stale: 4 } },
      ],
    }
    expect(fleetVerdict(one)).toEqual({
      tone: 'warn',
      head: 'Installs need a look.',
      facts: [
        '1 active install',
        'doctor clean',
        '1 install behind source',
        'no local edits',
        '4 files behind source',
      ],
    })
  })
  it('is healthy for one clean install, and an unreadable marker alone does not warn', () => {
    const one = {
      doctor: { ok: true, problems: [] },
      installs: [{ ...FLEET.installs[1], verdict: 'unknown' }],
    }
    expect(fleetVerdict(one)).toEqual({
      tone: 'good',
      head: 'Installs healthy.',
      facts: ['1 active install', 'doctor clean', 'all in sync with source', 'no local edits'],
    })
  })
  // KEPT EDITS (spec 2026-11-13). `kept` counts edited side files whose source still renders
  // what the last emit wrote: shown beside the local-edit fact, never turning the line amber. A
  // diverged edit keeps today's verdict. A kept `.md` is not in `kept` (D11, `driftCounts`), so
  // its drift arrives as a plain edit and warns.
  const withDrift = (drift) => ({
    doctor: { ok: true, problems: [] },
    installs: [
      { ...FLEET.installs[1], drift: { added: 0, missing: 0, linked: 0, stale: 0, ...drift } },
    ],
  })
  it.each([
    ['kept only', { edited: 1, kept: 1 }, 'good', 'no local edits, 1 kept edit'],
    ['one diverged', { edited: 1, kept: 0 }, 'warn', '1 local edit'],
    ['one diverged, two kept', { edited: 3, kept: 2 }, 'warn', '1 local edit, 2 kept edits'],
    ['one kept .md', { edited: 1, kept: 0 }, 'warn', '1 local edit'],
  ])('%s', (_, drift, tone, fact) => {
    const v = fleetVerdict(withDrift(drift))
    expect([v.tone, v.facts[3]]).toEqual([tone, fact])
  })
})

// A fleet row's session-start figure; 85 % of the 9 000 budget is 7 650.
const started = (host, chars, rest = {}) => ({
  id: host,
  host,
  scope: 'global',
  state: 'active',
  session_start: chars === null ? null : { chars, budget: 9000, cut: rest.cut ?? false },
  ...rest,
})

describe('sessionStartFigure', () => {
  it('shows the largest install, the budget as a whole number of KB', () => {
    const f = sessionStartFigure([
      started('bob', 6400),
      started('claude', 7500),
      started('x', null),
    ])
    expect([f.install.host, f.size]).toEqual(['claude', '7.5 / 9 KB'])
  })

  it('turns near at 85 % of the budget and not one character before', () => {
    expect(sessionStartFigure([started('claude', 7649)]).near).toBe(false)
    expect(sessionStartFigure([started('claude', 7650)]).near).toBe(true)
  })

  // 7 533 is 83.7 %, a real cut payload (rules of 16 000 characters); 7 641 is 84.9 %.
  it.each([
    ['cut at 83.7 %', 7533, true, true],
    ['uncut at 84.9 %', 7641, false, false],
    ['uncut at 85 %', 7650, false, true],
  ])('reads %s', (_name, chars, cut, near) => {
    expect(sessionStartFigure([started('claude', chars, { cut })]).near).toBe(near)
  })

  it('shows a cut install over a larger uncut one', () => {
    const f = sessionStartFigure([started('bob', 7641), started('claude', 7533, { cut: true })])
    expect([f.install.host, f.cut]).toEqual(['claude', true])
  })

  it('is null with no install measured', () => {
    expect(sessionStartFigure([started('opencode', null)])).toBeNull()
    expect(sessionStartFigure(undefined)).toBeNull()
  })
})

describe('ledgerNeeds session start', () => {
  const rows = (...installs) =>
    ledgerNeeds({ fleet: { installs } }).filter((r) => r.id === 'session-start')

  it('says nothing below the threshold', () => {
    expect(rows(started('claude', 7649))).toEqual([])
  })

  // Shared files are no install's, so the row names none; two installs near are still one row.
  it('is one suggestion at the threshold, with no install named for shared files', () => {
    const near = rows(
      started('claude', 7700, { shared: true }),
      started('bob', 7700, { shared: true }),
    )
    expect(near).toEqual([
      {
        id: 'session-start',
        tag: 'Session',
        tone: 'warn',
        sugg: true,
        title: 'Session files are near the session-start budget',
        detail: '7.7 / 9 KB · without project context',
        where: 'personal',
        verb: 'Trim',
        href: '#/personal',
      },
    ])
  })

  it('fires at exactly the threshold', () => {
    expect(rows(started('claude', 7650))).toHaveLength(1)
  })

  it('names the install when its files are its own', () => {
    expect(rows(started('claude', 8100, { shared: false }))[0].title).toBe(
      'Claude Code · global: session files are near the session-start budget',
    )
  })

  it('says content was cut, under the 85 % line, and stays silent for an uncut 84.9 %', () => {
    const [row] = rows(started('claude', 7533, { cut: true, shared: true }))
    expect([row.title, row.detail]).toEqual([
      'Session files were cut to fit the session-start budget',
      '7.5 / 9 KB · without project context',
    ])
    expect(rows(started('claude', 7533, { cut: true }))[0].title).toBe(
      'Claude Code · global: session files were cut to fit the session-start budget',
    )
    expect(rows(started('claude', 7641))).toEqual([])
  })
})

describe('ledgerNeeds', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW }))
  afterEach(() => vi.useRealTimers())
  // Kept edits (spec 2026-11-13 §5): still one row per install. Only kept edits left make a muted
  // suggestion with the same Review link; any edit that alerts keeps the problem row, which names
  // the kept ones in its detail.
  it('gives kept-only edits a suggestion and keeps alerting edits a problem', () => {
    const inst = (id, drift) => ({
      ...FLEET.installs[1],
      id,
      drift: { added: 0, missing: 0, linked: 0, stale: 0, ...drift },
    })
    const rows = ledgerNeeds({
      fleet: {
        doctor: { ok: true, problems: [] },
        installs: [inst('a', { edited: 2, kept: 2 }), inst('b', { edited: 2, kept: 1 })],
      },
      usage: null,
    }).filter((r) => r.id.startsWith('drift:'))
    expect(rows.map((r) => [r.id, r.tone, !!r.sugg, r.title, r.detail, r.href])).toEqual([
      [
        'drift:a',
        '',
        true,
        'Claude Code · global: 2 kept edits',
        'edited in place, source unchanged — nothing missed',
        '#/installs/edits',
      ],
      [
        'drift:b',
        'warn',
        false,
        'Claude Code · global: 1 local edit',
        '1 edited, 0 added, 0 missing, 1 kept',
        '#/installs/edits',
      ],
    ])
  })
  // Every suggestion names its install (D6): a fleet carrying `facts` gives one memory nudge per
  // install with none (not the old one-install `setup.facts`), and the profile and rules nudges,
  // read off the default install, are prefixed with it.
  it('names the install of each memory, profile and rules suggestion', () => {
    const fleet = {
      ...FLEET,
      installs: FLEET.installs.map((i, n) => ({ ...i, facts: n === 0 ? 0 : 4 })),
    }
    const rows = ledgerNeeds({
      fleet,
      usage: null,
      ...ALL,
      overview: { ...ALL.overview },
      defaultLabel: 'Claude Code · global',
    })
    const sugg = rows.filter((r) => r.sugg).map((r) => [r.id, r.title])
    expect(sugg.filter(([id]) => /^(memory|profile|rules)/.test(id))).toEqual([
      ['memory:oc', 'OpenCode · global: memory holds no facts'],
      ['profile', 'Claude Code · global: Profile is still the seeded template'],
      ['rules', 'Claude Code · global: No standing rules yet'],
    ])
  })
  // Global installs read one store: a shared memory, profile or rule file is one suggestion that
  // names no harness, however many installs read it. A project install with its own store keeps
  // its own row, and a project install's own files, read as the default, keep its name.
  it('says a shared store once and names no harness', () => {
    const fleet = {
      installs: [
        { id: 'oc', host: 'opencode', scope: 'global', state: 'active', facts: 0, shared: true },
        { id: 'cl', host: 'claude', scope: 'global', state: 'active', facts: 0, shared: true },
        {
          id: 'p',
          host: 'bob',
          scope: 'project',
          path: '/r/repo',
          state: 'active',
          facts: 0,
          shared: false,
        },
      ],
    }
    const rowsOf = (input) =>
      ledgerNeeds({ fleet, usage: null, defaultLabel: 'OpenCode · global', ...input })
        .filter((r) => /^(memory|profile|rules)/.test(r.id))
        .map((r) => [r.id, r.title])
    expect(
      rowsOf({
        rules: { ...ALL.rules, shared: true },
        profile: { ...ALL.profile, shared: true },
      }),
    ).toEqual([
      ['memory:shared', 'Memory holds no facts'],
      ['memory:p', 'repo · BOB (IBM): memory holds no facts'],
      ['profile', 'Profile is still the seeded template'],
      ['rules', 'No standing rules yet'],
    ])
    expect(rowsOf({ profile: { ...ALL.profile, shared: false } })).toContainEqual([
      'profile',
      'OpenCode · global: Profile is still the seeded template',
    ])
  })
  it('lists per-install problems first, then the older nudges as suggestions', () => {
    const rows = ledgerNeeds({ fleet: FLEET, usage: null, ...ALL, overview: { ...ALL.overview } })
    expect(rows.slice(0, 2)).toEqual([
      {
        id: 'behind:oc',
        tag: 'Behind',
        tone: 'warn',
        title: 'OpenCode · global is behind its source',
        detail: 'built 6d ago',
        where: 'OpenCode',
        verb: 'Rebuild',
        // Per install: the row rebuilds the one it names, never the whole machine.
        act: 'rebuild',
        installs: [
          { id: 'oc', host: 'opencode', path: '/h/.config/opencode', label: 'OpenCode · global' },
        ],
      },
      {
        id: 'drift:oc',
        tag: 'Local edits',
        tone: 'warn',
        title: 'OpenCode · global: 3 local edits',
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
  it('names stale files on the behind row and raises no local-edits row for them', () => {
    const fleet = {
      installs: [
        { ...FLEET.installs[0], drift: { edited: 0, added: 0, missing: 0, linked: 0, stale: 4 } },
      ],
    }
    const rows = ledgerNeeds({ fleet })
    expect(rows.map((r) => [r.id, r.title, r.detail])).toEqual([
      ['behind:oc', 'OpenCode · global is behind its source', 'built 6d ago · 4 files behind'],
    ])
  })
  // The usage ledger lists never-fired rows per install, so one skill unused on two installs
  // is two rows and still ONE skill.
  it('counts a skill never fired on two installs once', () => {
    const never = [
      { kind: 'skill', name: 'a', install: 'oc' },
      { kind: 'skill', name: 'a', install: 'cl' },
      { kind: 'agent', name: 'c', install: 'oc' },
      { kind: 'agent', name: 'c', install: 'cl' },
    ]
    const [row] = ledgerNeeds({ fleet: null, usage: { days_counted: 30, never } })
    expect([row.title, row.detail]).toEqual(['1 skill never fired in 30 days', '1 agent too'])
    expect(neverFired({ never })).toEqual({ skills: 1, agents: 1 })
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
          { rule: 'ownership', n: 1, per_day: [] },
        ],
      },
      LAWS,
    )
    expect(rows.map((r) => r.name)).toEqual(['Persist Insight', 'Wiki guard', 'Ownership gate'])
  })
})

describe('applyAccent', () => {
  // A yellow accent sits in the amber band of the warning colour, so the warning moves to the
  // approved orange under it (dark #FF8A4C; light #B4441F, with its text darkened to #9B3A1B so
  // it holds 4.5:1 on its own 15% tint), and only under it: another accent drops both overrides.
  it('moves --warn off a yellow accent and back', () => {
    const el = document.createElement('div')
    applyAccent(el, 'yellow', 'dark')
    expect(el.style.getPropertyValue('--warn')).toBe('#FF8A4C')
    expect(el.style.getPropertyValue('--warn-text')).toBe('#FF8A4C')
    applyAccent(el, 'yellow', 'light')
    expect(el.style.getPropertyValue('--warn')).toBe('#B4441F')
    expect(el.style.getPropertyValue('--warn-text')).toBe('#9B3A1B')
    applyAccent(el, 'cyan', 'dark')
    expect(el.style.getPropertyValue('--warn')).toBe('')
    expect(el.style.getPropertyValue('--warn-text')).toBe('')
  })
})

describe('needsRebuild', () => {
  // The fleet row's (and the header count's) test: an active install that is behind, has
  // hand edits or missing files, or has stale files. A disabled install never needs one.
  const zero = { edited: 0, added: 0, missing: 0 }
  it.each([
    ['behind', { state: 'active', verdict: 'behind', drift: zero }, true],
    ['edited', { state: 'active', verdict: 'synced', drift: { ...zero, edited: 1 } }, true],
    ['stale', { state: 'active', verdict: 'synced', drift: { ...zero, stale: 2 } }, true],
    ['in step', { state: 'active', verdict: 'synced', drift: zero }, false],
    ['in step, no drift read', { state: 'active', verdict: 'synced', drift: null }, false],
    ['disabled', { state: 'disabled', verdict: 'behind', drift: { ...zero, edited: 3 } }, false],
    // Kept edits (spec 2026-11-13, D9): a rebuild changes nothing there, so none is offered.
    [
      'kept only',
      { state: 'active', verdict: 'synced', drift: { ...zero, edited: 2, kept: 2 } },
      false,
    ],
    // One kept, one diverged: the diverged one still asks for the rebuild.
    [
      'kept + diverged',
      { state: 'active', verdict: 'synced', drift: { ...zero, edited: 2, kept: 1 } },
      true,
    ],
    // A kept `.md` is never counted in `kept` (D11, `driftCounts`), so it reads as an edit.
    [
      'kept .md',
      { state: 'active', verdict: 'synced', drift: { ...zero, edited: 1, kept: 0 } },
      true,
    ],
  ])('%s', (_, install, want) => {
    expect(needsRebuild(install)).toBe(want)
  })
})
