import { useLocalStorage } from './useLocalStorage.js'

const LAYOUT_KEY = 'geneseed-layout'

// Which view the Overview page shows, chosen independently of the visual flavour (the
// .fl-<id> skin); every skin reads theme tokens, so any skin renders under any view:
//   overview   - the default: health banner, three charts, the needs-attention list
//   cultivar   - StatusView      (hero + KPI strip + genome grid)
//   greenhouse - GreenhouseView  (readiness ring + tiles + mix donut)
//   operator   - OperatorHudView (dense terminal readout, check matrix)
//   journal    - JournalView     (growth rings, freshly grown, constitution map)
//
// ⚠ 'auto' IS RETIRED, AND IT READS AS `overview`. It used to mean "the lens this skin
// was drawn around" (Atlas the Journal, Operator the HUD), and useLocalStorage persists
// the default on first render, so nearly every browser holds a stored 'auto'. The new
// Overview is the console for everyone; keeping 'auto' as a pairing would have left
// every existing user on the old dashboard. The four old lenses are one click away on
// the Overview's own View control.
export const LAYOUTS = [
  { id: 'overview', short: 'Overview', tagline: 'Health, three charts, what needs you.' },
  { id: 'cultivar', short: 'Cultivar', tagline: 'Hero, KPIs & genome grid.' },
  { id: 'greenhouse', short: 'Greenhouse', tagline: 'Ring, tiles & mix donut.' },
  { id: 'operator', short: 'Operator', tagline: 'Dense terminal readout.' },
  { id: 'journal', short: 'Journal', tagline: 'Growth rings & the constitution map.' },
]

const VALID = new Set(LAYOUTS.map((l) => l.id))

// A stored value -> the view it shows: a known id is itself; 'auto', an unknown id or
// nothing at all is the Overview.
export function resolveLayout(v) {
  return v && VALID.has(v) ? v : 'overview'
}

// Persisted to localStorage. Returns [id, set].
export function useLayout() {
  return useLocalStorage(LAYOUT_KEY, resolveLayout)
}
