import { useLocalStorage } from './useLocalStorage.js'

const FLAV_KEY = 'geneseed-flavour'

// The console "directions" — each is a full visual skin applied as `fl-<id>` on
// .app, where the id is the theme's slug. See styles.css for the matching
// .fl-<slug> / .dir-<slug> blocks.
//   cultivar — Cultivar Evolved (current console, modernised; clinical & calm)
//   operator — Operator HUD     (dense terminal readout; sharp, all-mono)
//   matrix   — Matrix           (cyber-slick order-book; fixed green, Space Mono)
//   atlas    — Atlas            (field journal; loam dark, sage ink, Space Grotesk)
// Eight more shipped until 2026-09-30 and were cut to these four; RETIRED below
// keeps a stored choice of one of them landing on its nearest survivor.
export const FLAVOURS = [
  {
    id: 'cultivar',
    short: 'Cultivar',
    name: 'Cultivar Evolved',
    tagline:
      'The calm default — cool teal ink, geometric sans, soft flat cards lit by one quiet shadow.',
  },
  {
    id: 'operator',
    short: 'Operator',
    name: 'Operator HUD',
    tagline: 'Amber phosphor on cool charcoal — all-mono, zero-radius instrument readout.',
  },
  {
    id: 'matrix',
    short: 'Matrix',
    name: 'Matrix',
    tagline:
      'Acid-green order-book terminal on pure black — all Space Mono, square 2px, a faint code-grid.',
  },
  {
    id: 'atlas',
    short: 'Atlas',
    name: 'Atlas',
    tagline: 'The field journal — loam dark, sage ink, the codex as a living map.',
  },
]

const VALID = new Set(FLAVOURS.map((f) => f.id))

// Ids that no longer name a flavour → the survivor a stored choice lands on, so
// nobody silently resets to the default. Two generations: the single-letter ids
// from before the slug rename, and the eight skins cut on 2026-09-30. The organic
// Greenhouse goes to Atlas (its successor, same Journal lens); the mono terminals
// Cobalt and Neon go to Matrix; everything else to the Cultivar default.
const RETIRED = {
  a: 'cultivar',
  b: 'atlas',
  c: 'operator',
  d: 'cultivar',
  e: 'matrix',
  f: 'cultivar',
  g: 'cultivar',
  z: 'cultivar',
  cb: 'matrix',
  cm: 'cultivar',
  greenhouse: 'atlas',
  heirloom: 'cultivar',
  aurora: 'cultivar',
  perspective: 'cultivar',
  sequencer: 'cultivar',
  cobalt: 'matrix',
  cosmic: 'cultivar',
  neon: 'matrix',
}

// Persisted to localStorage, defaulting to `cultivar`. Returns [id, set] — a plain
// setter, no toggle, because there are several values not two.
export function useFlavour() {
  return useLocalStorage(FLAV_KEY, resolveFlavour)
}

// A stored value → the flavour it shows. Exported for the test that pins RETIRED.
export function resolveFlavour(v) {
  return VALID.has(v) ? v : RETIRED[v] || 'cultivar'
}
