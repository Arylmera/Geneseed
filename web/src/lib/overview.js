// Pure derivations behind the Overview page: each takes the payloads the page already
// fetched and returns plain rows for a chart or a list. Kept out of the component so a
// table of inputs -> rows can pin them (__tests__/overview.test.js), and so the component
// is only layout.
import { editCount } from './format.js'
import { SKILL_CATS, SKILL_CAT_ORDER } from './lawCats.js'
import { gateAddress, parseRuleTitle } from './constitution.js'

// The constitution's four tiers as one composition bar. `laws` is the catalog payload
// (/api/catalog/laws) when it has loaded: it is the only source that says which
// invariants are retired, so without it the invariant row carries no "retired" note
// rather than a guessed one. Doctrines count the rules in force, from the overview.
export function constitutionMix(counts, laws, rulesStats) {
  const items = laws?.items || []
  const retired = items.filter(
    (i) => (i.tier ?? 'invariant') === 'invariant' && parseRuleTitle(i.title).retired,
  ).length
  const invariants = (counts?.laws ?? 0) - retired
  const d = counts?.doctrines || {}
  return [
    { key: 'ethos', label: 'Ethos', n: counts?.ontology ?? 0 },
    {
      key: 'invariants',
      label: 'Invariants',
      n: invariants,
      note: laws ? `+${retired} retired` : '',
    },
    {
      key: 'doctrines',
      label: 'Doctrines',
      n: d.rules ?? 0,
      note: d.total != null ? `${d.active} of ${d.total} packs` : '',
    },
    { key: 'yours', label: 'Your rules', n: rulesStats?.rules ?? 0 },
  ]
}

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

// A run's kind, for the bar colour: `update` (git pull + rebuild), `rebuild` (build-all),
// or `other` (install, build, deploy, doctor...). The console labels a voice build
// `build (imperial · opencode-global)`, which is still a build.
export function runKind(action) {
  if (action === 'update') return 'update'
  if (action === 'build-all') return 'rebuild'
  return 'other'
}

// The last `n` finished runs as bars, oldest first: height is the duration relative to
// the longest one shown (floored so a 0.1 s run is still a visible bar), `ok` whether it
// exited cleanly. A run still going has no duration yet and is left out.
export function runBars(runs, n = 20) {
  const done = (runs || []).filter((r) => r.status !== 'running').slice(-n)
  const longest = Math.max(0, ...done.map((r) => r.duration || 0))
  return {
    bars: done.map((r) => ({
      id: r.id,
      kind: runKind(r.action),
      ok: r.status === 'done',
      h: longest ? Math.max(0.06, (r.duration || 0) / longest) : 0.06,
      tip: `${r.action} · ${r.status} · ${(r.duration ?? 0).toFixed(1)} s`,
    })),
    ok: done.filter((r) => r.status === 'done').length,
    longest,
  }
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
  const drift = diff ? editCount(diff) + (diff.missing ?? 0) : 0
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

// The health banner's verdict: 'bad' when the doctor failed, 'warn' when it passed but the
// install drifted or its fingerprint no longer matches the source, else 'good'.
export function healthTone(overview, setup) {
  if (overview?.doctor && !overview.doctor.ok) return 'bad'
  const diff = overview?.diff
  const drift = diff ? editCount(diff) + (diff.missing ?? 0) : 0
  const behind = setup && setup.installed_fp && setup.installed_fp !== setup.source_fp
  return drift || behind ? 'warn' : 'good'
}
