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
    tagline: 'The current console, modernised — clinical & calm.',
  },
  {
    id: 'greenhouse',
    short: 'Greenhouse',
    name: 'Greenhouse',
    tagline: 'Warm, organic, friendly — generous radius, soft cards.',
  },
  {
    id: 'operator',
    short: 'Operator',
    name: 'Operator HUD',
    tagline: 'Dense terminal readout — sharp panels, numbers not chrome.',
  },
  {
    id: 'heirloom',
    short: 'Heirloom',
    name: 'Heirloom',
    tagline: 'Premium editorial — plum-tinted surfaces, serif display, deep calm.',
  },
  {
    id: 'matrix',
    short: 'Matrix',
    name: 'Matrix',
    tagline: 'Cyber-slick order-book — flat green, Space Mono, 2px corners.',
  },
  {
    id: 'aurora',
    short: 'Aurora',
    name: 'Aurora Glass',
    tagline: 'Glassmorphism — frosted surfaces, aurora-lit deep navy.',
  },
  {
    id: 'perspective',
    short: 'Perspective',
    name: 'Perspective',
    tagline: 'Depth-driven — layered surfaces, cast shadows, Oswald display.',
  },
  {
    id: 'sequencer',
    short: 'Sequencer',
    name: 'Sequencer',
    tagline: 'Bright clinical dashboard — clean Inter cards, light or dark.',
  },
  {
    id: 'cobalt',
    short: 'Cobalt',
    name: 'Cobalt Terminal',
    tagline: 'Matrix-inspired terminal — blue #389DC6 on black, IBM Plex Mono, sharp.',
  },
  {
    id: 'cosmic',
    short: 'Cosmic',
    name: 'Cosmic',
    tagline: 'Deep-space sci-fi — navy void, Audiowide, glow & cut corners.',
  },
  {
    id: 'neon',
    short: 'Neon',
    name: 'Neon',
    tagline: 'Mono/matrix dark — hot-pink #F44174 on near-black, Geist Mono, glass.',
  },
]

const VALID = new Set(FLAVOURS.map((f) => f.id))

// Old single-letter ids (pre-rename) → current slugs, so a stored selection
// survives the rename instead of silently resetting to the default.
const LEGACY = {
  a: 'cultivar', b: 'greenhouse', c: 'operator', d: 'heirloom', e: 'matrix',
  f: 'aurora', g: 'perspective', z: 'sequencer', cb: 'cobalt', cm: 'cosmic',
}

// Persisted to localStorage, defaulting to `cultivar`. Returns [id, set] — a plain
// setter, no toggle, because there are several values not two.
export function useFlavour() {
  return useLocalStorage(FLAV_KEY, (v) => (VALID.has(v) ? v : LEGACY[v] || 'cultivar'))
}
