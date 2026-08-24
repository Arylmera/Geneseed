// The constitution's colour vocabulary — one class per invariant, one colour per
// doctrine pack. Shared, because two screens now paint the same rules: the Laws
// ledger's chips and rows, and the Journal dashboard's constitution map.
//
// SPLIT OUT OF Laws.jsx RATHER THAN IMPORTED FROM IT. The Dashboard ships in the
// app shell (it is the landing route, App.jsx says why), so a dashboard component
// importing the Laws page would drag the whole ledger — its LAW_META and
// DOCTRINE_META tables, its filters, its detail pane — into the chunk that must
// paint first. And Laws.jsx cannot move: `js/inspect/checks-authoring.mjs` reads
// that exact path for the LAW_META gate, and `tests/helpers/cli_golden.mjs`
// hard-requires it. So the shared half moves out and the file stays put.

export const LAW_CATS = {
  security: { label: 'Security', c: 'oklch(0.74 0.085 45)' },
  verify: { label: 'Verification', c: 'oklch(0.78 0.075 200)' },
  process: { label: 'Process', c: 'oklch(0.76 0.075 150)' },
  craft: { label: 'Craft', c: 'oklch(0.78 0.085 95)' },
  context: { label: 'Context', c: 'oklch(0.74 0.08 280)' },
  comms: { label: 'Communication', c: 'oklch(0.76 0.085 345)' },
}

export const LAW_CAT_ORDER = ['security', 'verify', 'process', 'craft', 'context', 'comms']

// A doctrine rule's class IS its pack — there is no second taxonomy over one. Colours only; the
// pack's NAME and blurb are themed and come from the API, so they are never transcribed here.
export const PACK_CATS = {
  craft: 'oklch(0.78 0.085 95)',
  rigor: 'oklch(0.78 0.075 200)',
  ops: 'oklch(0.76 0.075 150)',
  process: 'oklch(0.74 0.085 45)',
}

// TWO LOOKUPS, NOT ONE, AND THE MERGED VERSION WAS A BUG. The obvious helper is a
// single `lawCatColor(klass)` that tries LAW_CATS then PACK_CATS — but the two tables
// SHARE KEYS with different values: `process` is both an invariant class (green, hue
// 150) and a doctrine pack (orange, hue 45), and `craft` is in both as well. Whichever
// table such a helper checked first would silently win for those two, and it did: the
// `process` pack rendered in the invariant Process green, which is byte-identical to
// the `ops` pack's colour — so two packs came out the same on the map, and neither
// matched the same pack on the Constitution page.
//
// The caller always knows which tier it is drawing, so it says so.
export const invariantColor = (klass) => LAW_CATS[klass]?.c || 'var(--text-3)'
export const packColor = (pack) => PACK_CATS[pack] || 'var(--text-3)'
