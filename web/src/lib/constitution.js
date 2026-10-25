// Small, pure readers over the constitution catalog (/api/catalog/laws), shared by the
// Constitution page and the Overview. Laws.jsx itself cannot be imported from the shell
// (it is lazy), so what both need
// lives here.

// A catalog title -> its parts. Titles arrive as `Rule IV — Deletio Deliberata · Deletion
// Is Deliberate`, `Doctrine craft 1 — Machina Pro Labore · Automate Repetition`, or with
// a trailing `(retired)`. The Latin half is the voice's: a theme without one sends the
// plain name, and `latin` is then empty rather than a copy of the name.
export function parseRuleTitle(title) {
  let s = String(title || '')
  const retired = /\(retired\)\s*$/i.test(s)
  s = s.replace(/\s*\(retired\)\s*$/i, '')
  s = s.replace(/^(?:Rule\s+[IVXLCDM\d]+|Doctrine\s+[a-z]+\s+\d+)\s*[—-]\s*/i, '')
  const cut = s.indexOf(' · ')
  if (cut === -1) return { latin: '', name: s.trim(), retired }
  return { latin: s.slice(0, cut).trim(), name: s.slice(cut + 3).trim(), retired }
}

const ROMAN = [
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
]
const toRoman = (n) => {
  let out = ''
  for (const [v, r] of ROMAN)
    while (n >= v) {
      out += r
      n -= v
    }
  return out
}

// A gate-ledger key (setup.gates.asks) -> the catalog address of the rule behind it:
// `law-4` is invariant `IV`, `process-5` is doctrine `process.5`.
export function gateAddress(key) {
  const m = /^([a-z]+)-(\d+)$/.exec(String(key))
  if (!m) return String(key)
  return m[1] === 'law' ? toRoman(Number(m[2])) : `${m[1]}.${m[2]}`
}

// The rules a hook enforces, by catalog address. Transcribed from the doctor's HOOK_PINNED
// (js/inspect/checks-constitution.mjs): Law I's secret scan and process 1's persist check
// (rule-gate), Law III's Stop-hook done gate (js/hosts/hooks-done.mjs), Law IV's history
// rewrite and process 5's commit/push consent (git-gate), rigor 5's protected checks
// (rule-gate), and ops 2's root-scan check (git-gate).
// Transcribed, not imported: that module is node-side. __tests__/constitution.test.js imports
// the pin and fails when the two drift apart.
export const HOOK_GATED = new Set(['I', 'III', 'IV', 'process.1', 'process.5', 'rigor.5', 'ops.2'])

// The laws whose hook gate an install can switch off, by catalog address: the key the
// overview's `install` reports it under, and the switch's name. Transcribed from the server's
// GATE_SWITCHES (js/build/source.mjs: `--no-secrets-gate`, `--no-done-gate`, `--no-deletion-gate`).
// __tests__/constitution.test.js imports that table and fails when the two drift apart.
export const GATE_SWITCH = {
  I: { key: 'secretsGate', label: 'Secrets gate' },
  III: { key: 'doneGate', label: 'Done gate' },
  IV: { key: 'deletionGate', label: 'Deletion gate' },
}

// What each switch's confirm says it does, by the same address: `arm` when it re-arms, `off`
// when it switches off. Display copy for the Constitution's gate toggles; a module constant so
// it is not rebuilt on every render.
export const GATE_COPY = {
  I: {
    arm: 'Writes that would carry a credential-shaped string are refused again.',
    off:
      'A write carrying a credential-shaped string (on OpenCode, also a write to a key ' +
      'file) stops being refused. Rule I’s text still binds the agent; protected checks, ' +
      'real data loss and commit/push consent stay gated.',
  },
  III: {
    arm: 'A turn that edited files cannot end before the project’s declared checks pass.',
    off:
      'A turn that edited files may end without the checks in .geneseed/done-checks.txt ' +
      'passing. Rule III’s text still binds the agent; every other gate stays.',
  },
  IV: {
    arm: 'Commands that would lose data nothing else holds ask again.',
    off:
      'Commands that would really lose data — discarding uncommitted work, deleting an ' +
      'unpushed branch, removing untracked files — stop asking. Rule IV’s text still binds ' +
      'the agent; secrets, root-wide scans and commit/push consent stay gated.',
  },
}

// The four tiers by rank, highest first: rows 1-4 of the Precedence table in src/AGENT.md.tmpl,
// copied verbatim (`source` is the table's Source cell reduced to its token, `against` its
// "Against the rank above it" cell). `key` is the Constitution page's own name for the tier.
// Transcribed, not read: the template is not shipped to the browser. __tests__/constitution.test.js
// parses the real template and fails when the two drift apart.
export const PRECEDENCE = [
  { key: 'invariants', source: '{{LAWS}}', against: '—' },
  { key: 'yours', source: 'user-rules.md', against: 'may tighten a {{LAW}}, never repeal one' },
  { key: 'ethos', source: '{{ONTOLOGY}}', against: 'never against a user rule' },
  { key: 'doctrines', source: '{{DOCTRINES}}', against: 'may tighten, never repeal' },
]

// Rows 5 and 6 of the same table: they bind or inform how work runs but hold no rules, so the
// page prints them as plain lines under the four tiers. `label` is the page's short name for
// the source. Gated against the template by __tests__/constitution.test.js, like PRECEDENCE.
export const PRECEDENCE_INFORM = [
  { source: 'mode', label: 'Mode', against: 'binds how work runs' },
  {
    source: 'PROFILE.md, posture, theme',
    label: 'Profile, posture, theme',
    against: 'inform only; never bind',
  },
]

// Template text -> the Precedence table's rows, in the order they appear: `{ source, against }`
// each. The Source cell drops its article, `active`, backticks and the `(§n)` pointer, which
// leaves the token PRECEDENCE carries. Pure, so the gate can feed it a perturbed copy.
export function parsePrecedence(text) {
  const lines = String(text).split(/\r?\n/)
  const at = lines.findIndex((l) => l.startsWith('**Precedence.**'))
  if (at === -1) return []
  let i = at + 1
  while (i < lines.length && !lines[i].trim()) i++
  const rows = []
  // The table is the run of `|` lines after the heading; the first other line ends it.
  for (; i < lines.length && lines[i].startsWith('|'); i++) {
    const line = lines[i]
    const cells = line.split('|').map((c) => c.trim())
    if (!/^\d+$/.test(cells[1] || '')) continue // header and separator rows
    const source = cells[2]
      .replace(/^The\s+/, '')
      .replace(/^active\s+/, '')
      .replace(/`/g, '')
      .replace(/\s*\(§\d+\)$/, '')
    rows.push({ source, against: cells[3] })
  }
  return rows
}

// "Enforced by" for one row: a hook gate, or the instruction text alone. A switchable law's gate
// can be off per install (`gates` is the overview's `install`); its text still binds, so the row
// reads "Gate off" rather than "Instruction". Anything but an explicit `false` is armed.
export const enforcedBy = (addr, gates = {}) => {
  if (GATE_SWITCH[addr] && gates?.[GATE_SWITCH[addr].key] === false) return 'Gate off'
  return HOOK_GATED.has(addr) ? 'Hook gate' : 'Instruction'
}
