// Pure derivations behind the Overview page: each takes the payloads the page already
// fetched and returns plain rows for a chart or a list. Kept out of the component so a
// table of inputs -> rows can pin them (__tests__/overview.test.js), and so the component
// is only layout.
import { driftTotal, relTime } from './format.js'
import { SKILL_CATS, SKILL_CAT_ORDER } from './lawCats.js'
import { gateAddress, parseRuleTitle } from './constitution.js'

// Skills per class, split by lifecycle stage. `experimental` is the one stage the chart
// calls out; every other status (approved, a personal skill with none) counts as settled.
// Classes with no skill are dropped, and the order is the Library's class order.
export function skillsByStage(items) {
  const by = {}
  for (const s of items || []) {
    const k = SKILL_CATS[s.klass] ? s.klass : 'personal'
    const row = by[k] || (by[k] = { key: k, label: SKILL_CATS[k].label, ok: 0, exp: 0 })
    if (s.status === 'experimental') row.exp += 1
    else row.ok += 1
  }
  const rows = SKILL_CAT_ORDER.filter((k) => by[k]).map((k) => ({
    ...by[k],
    n: by[k].ok + by[k].exp,
  }))
  const total = rows.reduce((n, r) => n + r.n, 0)
  const experimental = rows.reduce((n, r) => n + r.exp, 0)
  const max = Math.max(1, ...rows.map((r) => r.n))
  return { rows, total, experimental, max }
}

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`

// What needs the user, from the real endpoints, most urgent first. Each input may be
// missing (a fetch that failed or has not landed), and a missing input produces no row:
// the list only ever claims what it has read. Row: { id, tag, tone, title, detail,
// where, verb, href }; `tone` is 'bad' | 'warn' | '' and colours the tag.
export function needsAttention({ overview, setup, rules, activity, profile, skills, laws }) {
  const out = []
  const doctor = overview?.doctor
  if (doctor && !doctor.ok) {
    out.push({
      id: 'doctor',
      tag: 'Doctor',
      tone: 'bad',
      title: `Doctor found ${plural(doctor.problems.length, 'problem')}`,
      detail: doctor.problems[0] || '',
      where: 'installs/doctor',
      verb: 'Review',
      href: '#/installs/doctor',
    })
  }
  const diff = overview?.diff
  const drift = driftTotal(diff)
  if (drift) {
    out.push({
      id: 'drift',
      tag: 'Drift',
      tone: 'warn',
      title: `${plural(drift, 'file')} drifted from the source`,
      detail: `${diff.edited} edited, ${diff.added} added, ${diff.missing} missing`,
      where: 'installs/edits',
      verb: 'Review',
      href: '#/installs/edits',
    })
  }
  if (profile?.seeded) {
    out.push({
      id: 'profile',
      tag: 'Profile',
      tone: 'warn',
      title: 'Profile is still the seeded template',
      detail: 'every section holds placeholder text',
      where: 'personal/profile',
      verb: 'Fill in',
      href: '#/personal/profile',
    })
  }
  const st = rules?.exists ? rules.stats : null
  if (st && st.rules === 0) {
    out.push({
      id: 'rules',
      tag: 'Rules',
      tone: '',
      title: 'No standing rules yet',
      detail: `0 of ${st.max_rules} · ${st.tokens} of ${st.max_tokens} tokens`,
      where: 'personal/rules',
      verb: 'Write a rule',
      href: '#/personal/rules',
    })
  }
  const asks = Object.entries(setup?.gates?.asks || {}).sort((a, b) => b[1] - a[1])
  if (asks.length) {
    const [gate, n] = asks[0]
    const addr = gateAddress(gate)
    const hit = (laws?.items || []).find((i) => i.name === addr)
    const name = hit ? parseRuleTitle(hit.title).name : addr
    out.push({
      id: 'gates',
      tag: 'Gates',
      tone: '',
      title: `${name} asked ${plural(n, 'time')}`,
      detail: `${n} of ${setup.gates.total} gate asks`,
      where: addr,
      verb: 'Review',
      href: `#/item/law/${encodeURIComponent(addr)}`,
    })
  }
  if (skills) {
    const { rows, experimental } = skillsByStage(skills.items)
    if (experimental) {
      out.push({
        id: 'skills',
        tag: 'Skills',
        tone: '',
        title: `${plural(experimental, 'skill')} still experimental`,
        detail: rows
          .filter((r) => r.exp)
          .sort((a, b) => b.exp - a.exp)
          .map((r) => `${r.label.toLowerCase()} ${r.exp}`)
          .join(', '),
        where: 'library/skills',
        verb: 'Triage',
        href: '#/skills',
      })
    }
  }
  if (setup && setup.facts === 0) {
    out.push({
      id: 'memory',
      tag: 'Memory',
      tone: '',
      title: 'Memory holds no facts',
      detail: 'MEMORY.md is an empty index',
      where: 'library/memory',
      verb: 'Open',
      href: '#/section/memory',
    })
  }
  if (activity && activity.enabled === false) {
    out.push({
      id: 'activity',
      tag: 'Activity',
      tone: '',
      title: 'Session tracking is off',
      detail: 'no per-session trace is kept',
      where: 'activity',
      verb: 'Turn on',
      href: '#/activity',
    })
  }
  return out
}

// ---- the Ledger: every installed harness at once (/api/fleet, /api/usage, /api/gates) ----

const driftOf = (i) => driftTotal(i.drift)

// The verdict line. 'bad' when the doctor failed; 'warn' when an install is behind its source
// or has hand edits; else 'good'. An install whose marker cannot be read ('unknown') does not
// make the line warn on its own: the row says "not checked", and the line claims only what
// was read.
export function fleetVerdict(fleet) {
  const all = fleet?.installs || []
  const act = all.filter((i) => i.state === 'active')
  const disabled = all.length - act.length
  const behind = act.filter((i) => i.verdict === 'behind').length
  const edited = act.reduce((n, i) => n + driftOf(i), 0)
  const d = fleet?.doctor
  const tone = d && !d.ok ? 'bad' : behind || edited ? 'warn' : 'good'
  const head = {
    good: 'Harness healthy.',
    warn: 'Harness needs a look.',
    bad: 'Harness has problems.',
  }[tone]
  const facts = [
    plural(act.length, 'active install') + (disabled ? `, ${disabled} disabled` : ''),
    !d
      ? 'doctor not run yet'
      : d.ok
        ? 'doctor clean'
        : `doctor found ${plural(d.problems.length, 'problem')}`,
    behind ? `${plural(behind, 'install')} behind source` : 'all in step with source',
    edited ? `${plural(edited, 'file')} hand-edited` : 'no hand edits',
  ]
  return { tone, head, facts }
}

// What an install injects every session, as chart segments (characters). The console
// shows ≈ chars ÷ 4 tokens; the ceiling applies to the root file alone.
export const COST_PARTS = [
  ['carrier', 'Root file'],
  ['skills', 'Skill list'],
  ['agents', 'Agent list'],
  ['context', 'Session files'],
]
export const costTotal = (c) => (c ? c.carrier + c.skills + c.agents + c.context : 0)
export const approxTokens = (chars) => `≈${(chars / 4 / 1000).toFixed(1)}k`

const installLabel = (i) => `${i.host} · ${i.scope}`

// Needs attention for the Ledger: PROBLEMS first (doctor, behind, hand edits), each naming its
// install, then the older per-install nudges as SUGGESTIONS (`sugg: true`, muted). Usage's
// never-fired row is held back until 30 days are counted, so a fresh install is not told every
// skill is unused. Rows carry `act` (a console action) or `href`, never both.
export function ledgerNeeds({ fleet, usage, ...rest }) {
  const out = []
  const d = fleet?.doctor
  if (d && !d.ok) {
    out.push({
      id: 'doctor',
      tag: 'Doctor',
      tone: 'bad',
      title: `Doctor found ${plural(d.problems.length, 'problem')}`,
      detail: d.problems[0] || '',
      where: 'installs/doctor',
      verb: 'Review',
      href: '#/installs/doctor',
    })
  }
  for (const i of (fleet?.installs || []).filter((x) => x.state === 'active')) {
    if (i.verdict === 'behind') {
      out.push({
        id: `behind:${i.id}`,
        tag: 'Behind',
        tone: 'warn',
        title: `${installLabel(i)} is behind its source`,
        detail: i.built_epoch ? `built ${relTime(i.built_epoch)} ago` : 'never built',
        where: i.host,
        verb: 'Rebuild',
        act: 'build-all',
      })
    }
    const n = driftOf(i)
    if (n) {
      out.push({
        id: `drift:${i.id}`,
        tag: 'Drift',
        tone: 'warn',
        title: `${installLabel(i)}: ${plural(n, 'file')} edited by hand`,
        detail: `${i.drift.edited} edited, ${i.drift.added} added, ${i.drift.missing} missing`,
        where: 'installs/edits',
        verb: 'Review',
        href: '#/installs/edits',
      })
    }
  }
  if (usage && usage.days_counted >= 30 && usage.never?.length) {
    const skills = usage.never.filter((x) => x.kind === 'skill').length
    out.push({
      id: 'usage',
      tag: 'Usage',
      tone: '',
      sugg: true,
      title: `${plural(skills, 'skill')} never fired in 30 days`,
      detail: `${plural(usage.never.length - skills, 'agent')} too`,
      where: 'library/skills',
      verb: 'Triage',
      href: '#/skills',
    })
  }
  // The single-install nudges, minus what the fleet rows above now say per install.
  const older = needsAttention({
    ...rest,
    overview: rest.overview && { ...rest.overview, doctor: null, diff: null },
  })
  for (const r of older) out.push({ ...r, sugg: true })
  return out
}

// Gate rows for the sparklines, named by the rule's principle when the catalog has it.
export function gateRows(gates, laws) {
  return (gates?.rules || []).map((r) => {
    const addr = gateAddress(r.rule)
    const hit = (laws?.items || []).find((i) => i.name === addr)
    return {
      ...r,
      name: hit ? parseRuleTitle(hit.title).name : r.rule === 'wiki' ? 'Wiki guard' : addr,
    }
  })
}
