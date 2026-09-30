import { useLocalStorage } from './useLocalStorage.js'
import { accentHex } from '../lib/accents.js'

const ACCENT_KEY = 'geneseed-accent'

// Where the accent colour comes from, chosen independently of the visual flavour:
//   auto          — follow the deployed voice's accent (App.jsx writes it inline on .app)
//   curated       — use each flavour's own designed signature colour (CURATED_ACCENT)
//   custom:<name> — one fixed colour whatever the voice or skin (CUSTOM_ACCENTS)
// Default 'auto' so the console wears the active voice; pick 'curated' to see each
// theme in the hue its author designed it around.
export const ACCENT_MODES = [
  { id: 'auto', short: 'Auto', tagline: "Follows the deployed voice's accent." },
  { id: 'curated', short: 'Curated', tagline: "Each theme's own signature colour." },
]

// The fixed picks reuse the voice accent palette (lib/accents.js), which already carries
// the dark fill, the light companion and the light-mode text colour for each. Red is left
// out because it reads as an error next to the danger colour, white because it has no
// usable light-mode value.
export const CUSTOM_ACCENTS = [
  ['cyan', 'Cyan'],
  ['blue', 'Blue'],
  ['magenta', 'Violet'],
  ['yellow', 'Amber'],
  ['green', 'Green'],
].map(([name, short]) => ({
  id: `custom:${name}`,
  name,
  short,
  hex: accentHex(name),
  tagline: `Always ${short.toLowerCase()}, whatever the voice or skin.`,
}))

const ALL = [...ACCENT_MODES, ...CUSTOM_ACCENTS]
const VALID = new Set(ALL.map((m) => m.id))

// A stored value -> the mode it applies. Exported for the test that pins it.
export const resolveAccentMode = (v) => (v && VALID.has(v) ? v : 'auto')

// The palette name a custom mode applies, or null for auto / curated.
export const customAccentName = (mode) => CUSTOM_ACCENTS.find((c) => c.id === mode)?.name ?? null

export const accentTagline = (mode) => ALL.find((m) => m.id === mode)?.tagline ?? ''

// Persisted to localStorage, defaulting to 'auto'. Returns [id, set].
export function useAccentMode() {
  return useLocalStorage(ACCENT_KEY, resolveAccentMode)
}
