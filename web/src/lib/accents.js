// ANSI accent name (a theme's ACCENT field) -> Cultivar UI palette. The single
// source for live theming, the theme gallery, and the voice popover.
export const ACCENT_HEX = {
  red: '#FF5C57',
  green: '#4ED888',
  yellow: '#E8B53D',
  blue: '#5B8CFF',
  magenta: '#C77DFF',
  cyan: '#3AD4C4',
  white: '#E9EFEA',
}

// Darker companion per accent (gradient ends, light-mode reads this as the base).
export const ACCENT_2 = {
  red: '#C53A36',
  green: '#2FA864',
  yellow: '#B8862A',
  blue: '#3C66D8',
  magenta: '#9A52D6',
  cyan: '#2BA89B',
  white: '#AEB8B0',
}

export const accentHex = (name) => ACCENT_HEX[name] || ACCENT_HEX.cyan

// Readable text on a filled accent.
export const accentInk = (name) =>
  name === 'yellow' || name === 'white' || name === 'cyan' || name === 'green'
    ? '#06100D'
    : '#FFFFFF'

// Set the live accent on the app root. Light mode reads the deeper companion so
// small text and strokes stay legible on a pale surface; the 'white' accent is
// unusable on light and falls back to slate.
export function applyAccent(el, name, mode) {
  if (!el) return
  const light = mode === 'light'
  let hex = light ? ACCENT_2[name] || ACCENT_2.cyan : accentHex(name)
  let ink = light ? '#FFFFFF' : accentInk(name)
  if (light && name === 'white') {
    hex = '#566B62'
    ink = '#FFFFFF'
  }
  el.style.setProperty('--accent', hex)
  el.style.setProperty('--accent-2', ACCENT_2[name] || ACCENT_2.cyan)
  el.style.setProperty('--accent-ink', ink)
}

// Each flavour's CURATED signature accent — used when the accent mode is 'curated'
// instead of the deployed voice's accent. `dark` is the bright on-dark value;
// `light` is the deeper companion (also the gradient end / --accent-2); `ink` /
// `inkLight` are the readable text colour on a filled accent in each mode.
export const CURATED_ACCENT = {
  cultivar:    { dark: '#3AD4C4', light: '#1F9E92', ink: '#06100D', inkLight: '#FFFFFF' },
  greenhouse:  { dark: '#5BD08A', light: '#2C9A5E', ink: '#06100D', inkLight: '#FFFFFF' },
  operator:    { dark: '#E8A23B', light: '#B07914', ink: '#1A1306', inkLight: '#FFFFFF' },
  heirloom:    { dark: '#B9A6C6', light: '#6E5A7C', ink: '#1B1622', inkLight: '#FFFFFF' },
  matrix:      { dark: '#26A17B', light: '#18815F', ink: '#06100D', inkLight: '#FFFFFF' },
  aurora:      { dark: '#8AFFC4', light: '#0EA66D', ink: '#04231A', inkLight: '#FFFFFF' },
  perspective: { dark: '#00BD7D', light: '#00A86E', ink: '#04130D', inkLight: '#04130D' },
  sequencer:   { dark: '#155DFC', light: '#1447E6', ink: '#FFFFFF', inkLight: '#FFFFFF' },
  cobalt:      { dark: '#389DC6', light: '#1E6F92', ink: '#021015', inkLight: '#FFFFFF' },
  cosmic:      { dark: '#2670AD', light: '#1A5080', ink: '#E6F2FF', inkLight: '#FFFFFF' },
  neon:        { dark: '#F44174', light: '#D81E5B', ink: '#FFFFFF', inkLight: '#FFFFFF' },
}

// Write a flavour's curated accent on the app root (light reads the deeper
// companion). Returns false when the flavour has no curated entry, so the caller
// can fall back to the voice accent.
export function applyCuratedAccent(el, flavour, mode) {
  const c = CURATED_ACCENT[flavour]
  if (!el || !c) return false
  const light = mode === 'light'
  el.style.setProperty('--accent', light ? c.light : c.dark)
  el.style.setProperty('--accent-2', c.light)
  el.style.setProperty('--accent-ink', light ? c.inkLight : c.ink)
  return true
}
