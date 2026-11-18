// The Models page's pure parts: what a model id means on the page, and the picker's groups.
// The server (js/web/model-catalog.mjs) lists `models` and `groups`; nothing here reaches a key.

/** The hosts that take a per-agent model: every host but Bob. */
export const MODEL_HOSTS = ['claude', 'opencode', 'openclaude']

/** Why an agent runs on its model, in words. `routing` is the install's recorded `--tiers`. */
export function becauseOf(from, routing) {
  if (from === 'pin') return 'pin'
  if (from === 'map') return 'tiers map'
  if (from === 'default') return 'tier default'
  return routing === 'auto' ? 'session model' : 'routing off'
}

/** True when a source lists `id` (the In use copy of an id does not count as a source). */
export const isDetected = (models, id) =>
  !id || id === 'inherit' || models.some((m) => m.id === id && m.provider !== 'in-use')

/** The tier's model as the saved file says it: a named key (empty included), else the host default. */
export function tierNow(data, tier) {
  if (Object.hasOwn(data.map || {}, tier)) return data.map[tier]
  return data.defaults?.[tier] ?? ''
}

const hay = (m) => `${m.id} ${m.name} ${m.providerName} ${m.note || ''}`.toLowerCase()

/**
 * The picker's groups, in the order the server listed them (session first, In use last), each with
 * the models that match `q`. A group left with no match is dropped, except while the query is empty:
 * a local runtime that is not running still shows, with its reason.
 */
export function pickerGroups(data, q) {
  const needle = (q || '').trim().toLowerCase()
  const out = []
  for (const g of data.groups || []) {
    const rows = (data.models || []).filter(
      (m) => m.provider === g.provider && m.source === g.source,
    )
    const shown = needle ? rows.filter((m) => hay(m).includes(needle)) : rows
    if (needle && !shown.length) continue
    out.push({ ...g, rows: shown })
  }
  return out
}

/** `128k`, `1.0M`: a context window the way a model card spells it. */
export function tokens(n) {
  if (typeof n !== 'number') return ''
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

/** `$3 / $15 per 1M`, or '' when the price is not known. */
export function priceOf(cost) {
  if (!cost) return ''
  const f = (v) => (v === null || v === undefined ? '?' : `$${+v.toFixed(2)}`)
  return `${f(cost.input)} in / ${f(cost.output)} out per 1M`
}
