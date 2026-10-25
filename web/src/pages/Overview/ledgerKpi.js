// The Ledger's KPI row, as pure sums over the payloads the page already fetched (/api/fleet,
// /api/usage, /api/gates). Kept out of the component so __tests__/ledgerLayout.test.jsx can
// pin each figure against hand-worked fixtures. Every helper returns null (or zero) when it
// has nothing to measure, and the card says so in words.
import { costTotal, gateRows } from '../../lib/overview.js'

// Active installs with a measured cost: the only rows either cost figure may claim.
const measured = (installs) => (installs || []).filter((i) => i.state === 'active' && i.cost)

// The install whose root file sits closest to (or furthest past) its ceiling. Installs with no
// ceiling have no share to rank, so they are left out rather than ranked at zero.
export function worstRootFile(installs) {
  let worst = null
  for (const i of measured(installs)) {
    if (!(i.cost.ceiling > 0) || !Number.isFinite(i.cost.carrier)) continue
    const share = i.cost.carrier / i.cost.ceiling
    if (!worst || share > worst.share) worst = { i, share }
  }
  if (!worst) return null
  const { carrier, ceiling } = worst.i.cost
  return {
    label: `${worst.i.host} · ${worst.i.scope}`,
    carrier,
    ceiling,
    pct: Math.round(worst.share * 100),
  }
}

// The always-on spread across the fleet, in characters, and the most expensive install
// (`top`), whose parts the card draws.
export function alwaysOnRange(installs) {
  const act = measured(installs)
  if (!act.length) return null
  const top = act.reduce((a, b) => (costTotal(b.cost) > costTotal(a.cost) ? b : a))
  const totals = act.map((i) => costTotal(i.cost))
  return { min: Math.min(...totals), max: Math.max(...totals), top }
}

export const usageTotal = (usage) => (usage?.per_day || []).reduce((a, b) => a + b, 0)

// Every gate ask in the window, the rule that asked most (named by its principle when the
// catalog has it), and the asks per day summed across rules for the sparkline.
export function gateSummary(gates, laws) {
  const rows = gateRows(gates, laws)
  const total = rows.reduce((n, r) => n + r.n, 0)
  const lead = rows.reduce((a, b) => (!a || b.n > a.n ? b : a), null)
  // Aligned from index 0: the API sends every rule the same 30 days (js/web/gates-api.mjs).
  const perDay = []
  for (const r of rows)
    (r.per_day || []).forEach((v, d) => {
      perDay[d] = (perDay[d] || 0) + v
    })
  return { total, top: lead ? { name: lead.name, n: lead.n } : null, perDay }
}
