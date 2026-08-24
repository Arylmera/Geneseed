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

// The colour for a rule's class, whichever tier it is on: an invariant's is one of
// LAW_CATS' six, a doctrine rule's is its pack. Falls back to the muted text token,
// so a class this table has never heard of renders grey rather than not at all.
export const lawCatColor = (klass) => LAW_CATS[klass]?.c || PACK_CATS[klass] || 'var(--text-3)'
