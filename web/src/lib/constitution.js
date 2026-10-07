// Small, pure readers over the constitution catalog (/api/catalog/laws), shared by the
// Constitution page and the Overview. Laws.jsx itself cannot be imported from the shell
// (it is lazy, and doctor reads LAW_META out of that exact path), so what both need
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

// The rules a hook enforces at the tool boundary, by catalog address. Transcribed from
// js/hosts/hooks.mjs, whose `ask(args, <gate>, <id>, ...)` calls are the gates: Law I's
// secret scan and process 1's persist check (rule-gate), Law IV's history rewrite and
// process 5's commit/push consent (git-gate), and rigor 5's protected checks (rule-gate).
// __tests__/constitution.test.js reads that file and fails when the two drift apart.
export const HOOK_GATED = new Set(['I', 'IV', 'process.1', 'process.5', 'rigor.5'])

// "Enforced by" for one row: a hook gate, or the instruction text alone.
export const enforcedBy = (addr) => (HOOK_GATED.has(addr) ? 'Hook gate' : 'Instruction')
