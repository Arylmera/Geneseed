import { useLocalStorage } from './useLocalStorage.js'

const LAYOUT_KEY = 'geneseed-layout'

// The dashboard Status lens is a layout, chosen independently of the visual
// flavour (the .fl-<id> skin). Four layouts exist — every flavour's skin reads
// theme tokens, so any skin renders under any layout:
//   cultivar   — StatusView      (hero + KPI strip + genome grid)
//   greenhouse — GreenhouseView  (readiness ring + tiles + mix donut)
//   operator   — OperatorHudView (dense terminal readout, check matrix)
//   journal    — JournalView     (growth rings, freshly grown, constitution map)
// 'auto' (the default) follows the layout each flavour was designed around, so
// existing installs see no change until the user picks one explicitly.
export const LAYOUTS = [
  { id: 'auto', short: 'Auto', tagline: 'Follows the theme.' },
  { id: 'cultivar', short: 'Cultivar', tagline: 'Hero, KPIs & genome grid.' },
  { id: 'greenhouse', short: 'Greenhouse', tagline: 'Ring, tiles & mix donut.' },
  { id: 'operator', short: 'Operator', tagline: 'Dense terminal readout.' },
  { id: 'journal', short: 'Journal', tagline: 'Growth rings & the constitution map.' },
]

const VALID = new Set(LAYOUTS.map((l) => l.id))

// The layout each flavour was designed around — the 'auto' fallback. Atlas was
// drawn for the Journal, Operator keeps its dense HUD readout, and Cultivar and
// Matrix take the Cultivar genome grid (a grid of cells suits "the matrix").
// The Greenhouse lens is no flavour's default since its skin was cut; it stays
// one click away in Settings, which is why this table is separate from the flavour.
export function defaultLayoutFor(flavour) {
  if (flavour === 'atlas') return 'journal'
  if (flavour === 'operator') return 'operator'
  return 'cultivar'
}

// Effective layout: an explicit choice wins; 'auto' resolves to the flavour's
// designed layout. Always returns a concrete lens id (never 'auto').
export function resolveLayout(flavour, layout) {
  return layout && layout !== 'auto' && VALID.has(layout) ? layout : defaultLayoutFor(flavour)
}

// Persisted to localStorage, defaulting to 'auto'. Returns [id, set].
export function useLayout() {
  return useLocalStorage(LAYOUT_KEY, (v) => (v && VALID.has(v) ? v : 'auto'))
}
