// ANSI accent name (a theme's ACCENT field) -> Cultivar UI palette. The single
// source for live theming, the theme gallery, and the voice popover.
const ACCENT_HEX = {
  red: '#FF5C57',
  green: '#4ED888',
  yellow: '#E8B53D',
  blue: '#5B8CFF',
  magenta: '#C77DFF',
  cyan: '#3AD4C4',
  white: '#E9EFEA',
}

// Darker companion per accent (gradient ends, light-mode reads this as the base).
const ACCENT_2 = {
  red: '#C53A36',
  green: '#2FA864',
  yellow: '#B8862A',
  blue: '#3C66D8',
  magenta: '#9A52D6',
  cyan: '#2BA89B',
  white: '#AEB8B0',
}

export const accentHex = (name) => ACCENT_HEX[name] || ACCENT_HEX.cyan

// Accent-coloured TEXT on light surfaces. The fill colour (ACCENT_2 in light mode) sits near
// 3:1 on the pale page, enough for a bar or a button but not for a link or a label; these
// darker companions clear 4.5:1 on the light surfaces. Dark mode reads the fill itself.
export const ACCENT_TEXT_LIGHT = {
  red: '#A92F2B',
  green: '#1E7A47',
  yellow: '#8A6414',
  blue: '#2F55C0',
  magenta: '#7E3FB8',
  cyan: '#15766C',
  white: '#465A51',
}

// Readable text on a filled accent.
const accentInk = (name) =>
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
  el.style.setProperty(
    '--accent-text',
    light ? ACCENT_TEXT_LIGHT[name] || ACCENT_TEXT_LIGHT.cyan : hex,
  )
}

// Each flavour's CURATED signature accent — used when the accent mode is 'curated'
// instead of the deployed voice's accent. `dark` is the bright on-dark value;
// `light` is the deeper companion (also the gradient end / --accent-2); `ink` /
// `inkLight` are the readable text colour on a filled accent in each mode.
export const CURATED_ACCENT = {
  cultivar: { dark: '#3AD4C4', light: '#127E73', ink: '#06100D', inkLight: '#FFFFFF' },
  operator: { dark: '#E8A23B', light: '#8F5E10', ink: '#1A1306', inkLight: '#FFFFFF' },
  matrix: { dark: '#19E37C', light: '#0B7A47', ink: '#04140C', inkLight: '#FFFFFF' },
  // Atlas' sage, and the ink is the prototype's own #14200F rather than the shared
  // near-black: a sage fill wants a dark GREEN on it, not a neutral, or the primary
  // button reads as a sticker laid over the page instead of part of it.
  atlas: { dark: '#8FD694', light: '#1C8450', ink: '#14200F', inkLight: '#FFFFFF' },
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
  // The curated light values are already the deep companions, dark enough to read as text.
  el.style.setProperty('--accent-text', light ? c.light : c.dark)
  return true
}
