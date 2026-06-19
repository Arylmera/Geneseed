import { useLocalStorage } from './useLocalStorage.js'

const FLAV_KEY = 'geneseed-flavour'

// The three console "directions" from the redesign exploration:
//   a — Cultivar Evolved (current console, modernised; clinical & calm)
//   b — Greenhouse        (warm, organic, friendly; generous radius)
//   c — Operator HUD      (dense terminal readout; sharp, all-mono)
// Stored as a single-letter id so the class we drop on .app is just `fl-<id>`.
export const FLAVOURS = [
  {
    id: 'a',
    short: 'Cultivar',
    name: 'Cultivar Evolved',
    tagline: 'The current console, modernised — clinical & calm.',
  },
  {
    id: 'b',
    short: 'Greenhouse',
    name: 'Greenhouse',
    tagline: 'Warm, organic, friendly — generous radius, soft cards.',
  },
  {
    id: 'c',
    short: 'Operator',
    name: 'Operator HUD',
    tagline: 'Dense terminal readout — sharp panels, numbers not chrome.',
  },
]

const VALID = new Set(FLAVOURS.map((f) => f.id))

// Persisted to localStorage, defaulting to `a`. Returns [id, set] — a plain setter,
// no toggle, because there are three values not two.
export function useFlavour() {
  return useLocalStorage(FLAV_KEY, (v) => (v && VALID.has(v) ? v : 'a'))
}
