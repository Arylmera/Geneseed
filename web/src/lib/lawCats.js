// The constitution's colour vocabulary — one class per invariant, one colour per
// doctrine pack. Shared, because three taxonomies now paint with it: the Laws
// ledger's chips and rows, the Journal dashboard's constitution map, and Skills'
// own SKILL_CATS — a different set of keys and labels over the SAME six hues
// (CAT_HUES below), which is why the "SKILL_CATS is a fourth, ungated taxonomy
// copy" README debris bullet was really about the hues never being shared, not
// about the labels — Skills legitimately needs its own label per class.
//
// SPLIT OUT OF Laws.jsx RATHER THAN IMPORTED FROM IT. The Dashboard ships in the
// app shell (it is the landing route, App.jsx says why), so a dashboard component
// importing the Laws page would drag the whole ledger — its LAW_META and
// DOCTRINE_META tables, its filters, its detail pane — into the chunk that must
// paint first. And Laws.jsx cannot move: `js/inspect/checks-authoring.mjs` reads
// that exact path for the LAW_META gate, and `tests/helpers/cli_golden.mjs`
// hard-requires it. So the shared half moves out and the file stays put.

export const CAT_HUES = {
  security: 'oklch(0.74 0.085 45)',
  verify: 'oklch(0.78 0.075 200)',
  process: 'oklch(0.76 0.075 150)',
  craft: 'oklch(0.78 0.085 95)',
  context: 'oklch(0.74 0.08 280)',
  comms: 'oklch(0.76 0.085 345)',
}

export const LAW_CATS = {
  security: { label: 'Security', c: CAT_HUES.security },
  verify: { label: 'Verification', c: CAT_HUES.verify },
  process: { label: 'Process', c: CAT_HUES.process },
  craft: { label: 'Craft', c: CAT_HUES.craft },
  context: { label: 'Context', c: CAT_HUES.context },
  comms: { label: 'Communication', c: CAT_HUES.comms },
}

export const LAW_CAT_ORDER = ['security', 'verify', 'process', 'craft', 'context', 'comms']

// A doctrine rule's class IS its pack — there is no second taxonomy over one. Colours only; the
// pack's NAME and blurb are themed and come from the API, so they are never transcribed here.
export const PACK_CATS = {
  craft: CAT_HUES.craft,
  rigor: CAT_HUES.verify,
  ops: CAT_HUES.process,
  process: CAT_HUES.security,
}

export const packColor = (pack) => PACK_CATS[pack] || 'var(--text-3)'
