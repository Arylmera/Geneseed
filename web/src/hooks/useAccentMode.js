import { useLocalStorage } from './useLocalStorage.js'

const ACCENT_KEY = 'geneseed-accent'

// Where the accent colour comes from, chosen independently of the visual flavour:
//   auto    — follow the deployed voice's accent (App.jsx writes it inline on .app)
//   curated — use each flavour's own designed signature colour (CURATED_ACCENT)
// Default 'auto' so the console wears the active voice; pick 'curated' to see each
// theme in the hue its author designed it around.
export const ACCENT_MODES = [
  { id: 'auto', short: 'Auto', tagline: "Follows the deployed voice's accent." },
  { id: 'curated', short: 'Curated', tagline: "Each theme's own signature colour." },
]

const VALID = new Set(ACCENT_MODES.map((m) => m.id))

// Persisted to localStorage, defaulting to 'auto'. Returns [id, set].
export function useAccentMode() {
  return useLocalStorage(ACCENT_KEY, (v) => (v && VALID.has(v) ? v : 'auto'))
}
