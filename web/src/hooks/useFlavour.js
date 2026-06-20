import { useLocalStorage } from './useLocalStorage.js'

const FLAV_KEY = 'geneseed-flavour'

// The console "directions" — each is a full visual skin applied as `fl-<id>` on
// .app, where the id is the theme's slug. See styles.css for the matching
// .fl-<slug> / .dir-<slug> blocks.
//   cultivar    — Cultivar Evolved (current console, modernised; clinical & calm)
//   greenhouse  — Greenhouse       (warm, organic, friendly; generous radius)
//   operator    — Operator HUD     (dense terminal readout; sharp, all-mono)
//   heirloom    — Heirloom         (premium editorial; plum-tinted, serif display)
//   matrix      — Matrix           (cyber-slick order-book; fixed green, Space Mono)
//   aurora      — Aurora Glass     (glassmorphism; frosted surfaces, deep navy)
//   perspective — Perspective      (depth-driven; layered shadows, Oswald)
//   sequencer   — Sequencer        (bright clinical dashboard; Inter, light/dark)
//   cobalt      — Cobalt Terminal  (mono terminal; fixed blue, IBM Plex Mono)
//   cosmic      — Cosmic           (deep-space sci-fi; Audiowide, cut corners)
//   neon        — Neon             (mono dark; fixed hot-pink, Geist Mono, glass)
export const FLAVOURS = [
  {
    id: 'cultivar',
    short: 'Cultivar',
    name: 'Cultivar Evolved',
    tagline:
      'The calm default — cool teal ink, geometric sans, soft flat cards lit by one quiet shadow.',
  },
  {
    id: 'greenhouse',
    short: 'Greenhouse',
    name: 'Greenhouse',
    tagline:
      'Warm loam dark, fresh sage green, rounded humanist type — the softest, friendliest skin.',
  },
  {
    id: 'operator',
    short: 'Operator',
    name: 'Operator HUD',
    tagline: 'Amber phosphor on cool charcoal — all-mono, zero-radius instrument readout.',
  },
  {
    id: 'heirloom',
    short: 'Heirloom',
    name: 'Heirloom',
    tagline: 'Aubergine plum and serif display — the one luxe, calm, editorial skin.',
  },
  {
    id: 'matrix',
    short: 'Matrix',
    name: 'Matrix',
    tagline:
      'Acid-green order-book terminal on pure black — all Space Mono, square 2px, a faint code-grid.',
  },
  {
    id: 'aurora',
    short: 'Aurora',
    name: 'Aurora Glass',
    tagline:
      'The glass skin — frosted navy panels lit by a cyan-to-violet aurora, airy and weightless.',
  },
  {
    id: 'perspective',
    short: 'Perspective',
    name: 'Perspective',
    tagline:
      'Coral on cool slate, condensed-architectural headings, cards that physically lift off the page.',
  },
  {
    id: 'sequencer',
    short: 'Sequencer',
    name: 'Sequencer',
    tagline:
      'A quant terminal in daylight — indigo on white, Inter, lining numerals on a fine ruled grid.',
  },
  {
    id: 'cobalt',
    short: 'Cobalt',
    name: 'Cobalt Terminal',
    tagline: 'Electric-blue hacker terminal — all-mono, 2px corners, CRT scanlines on near-black.',
  },
  {
    id: 'cosmic',
    short: 'Cosmic',
    name: 'Cosmic',
    tagline:
      'Violet-magenta nebula on near-black — wide Audiowide wordmark, chamfered sci-fi instrumentation.',
  },
  {
    id: 'neon',
    short: 'Neon',
    name: 'Neon',
    tagline: 'Neon-noir: hot-pink edge-glow on near-black, all-mono Geist, frosted glass.',
  },
]

const VALID = new Set(FLAVOURS.map((f) => f.id))

// Old single-letter ids (pre-rename) → current slugs, so a stored selection
// survives the rename instead of silently resetting to the default.
const LEGACY = {
  a: 'cultivar',
  b: 'greenhouse',
  c: 'operator',
  d: 'heirloom',
  e: 'matrix',
  f: 'aurora',
  g: 'perspective',
  z: 'sequencer',
  cb: 'cobalt',
  cm: 'cosmic',
}

// Persisted to localStorage, defaulting to `cultivar`. Returns [id, set] — a plain
// setter, no toggle, because there are several values not two.
export function useFlavour() {
  return useLocalStorage(FLAV_KEY, (v) => (VALID.has(v) ? v : LEGACY[v] || 'cultivar'))
}
