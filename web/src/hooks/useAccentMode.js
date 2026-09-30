import { useLocalStorage } from './useLocalStorage.js'
import { accentHex, isHexColour } from '../lib/accents.js'

const ACCENT_KEY = 'geneseed-accent'

// Where the accent colour comes from, chosen independently of the visual flavour, and
// saved in this browser (localStorage):
//   curated       — each flavour's own designed signature colour (CURATED_ACCENT); default
//   custom:<name> — one of five fixed colours from the voice palette (CUSTOM_ACCENTS)
//   hex:#RRGGBB   — any colour from the picker; its companions are derived (hexAccent)
// There was an 'auto' mode that followed the deployed voice; it was dropped because it
// only ever showed a colour the fixed picks already offer. A stored 'auto' reads as curated.
export const ACCENT_MODES = [
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

const FIXED = [...ACCENT_MODES, ...CUSTOM_ACCENTS]
const VALID = new Set(FIXED.map((m) => m.id))

// The colour a picker mode holds (`hex:#RRGGBB`), or null.
export const pickedHex = (mode) => {
  const hex = typeof mode === 'string' && mode.startsWith('hex:') ? mode.slice(4) : null
  return isHexColour(hex) ? hex.toUpperCase() : null
}

// A stored value -> the mode it applies. Exported for the test that pins it.
export const resolveAccentMode = (v) => (v && (VALID.has(v) || pickedHex(v)) ? v : 'curated')

// The palette name a fixed mode applies, or null.
export const customAccentName = (mode) => CUSTOM_ACCENTS.find((c) => c.id === mode)?.name ?? null

export const accentTagline = (mode) => {
  const hex = pickedHex(mode)
  if (hex) return `Your own colour, ${hex}.`
  return FIXED.find((m) => m.id === mode)?.tagline ?? ''
}

// Persisted to localStorage, defaulting to 'curated'. Returns [id, set].
export function useAccentMode() {
  return useLocalStorage(ACCENT_KEY, resolveAccentMode)
}
