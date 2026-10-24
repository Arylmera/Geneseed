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
// darker companions are the starting text colour, and `accentText` darkens each further only
// where a flavour's real surface or the soft accent tint needs it. Dark mode starts from the fill.
export const ACCENT_TEXT_LIGHT = {
  red: '#A92F2B',
  green: '#1E7A47',
  yellow: '#8A6414',
  blue: '#2F55C0',
  magenta: '#7E3FB8',
  cyan: '#15766C',
  white: '#465A51',
}

// Set the live accent on the app root. Light mode reads the deeper companion so
// small text and strokes stay legible on a pale surface; the 'white' accent is
// unusable on light and falls back to slate.
export function applyAccent(el, name, mode) {
  if (!el) return
  const light = mode === 'light'
  let hex = light ? ACCENT_2[name] || ACCENT_2.cyan : accentHex(name)
  if (light && name === 'white') hex = '#566B62'
  const text = light ? ACCENT_TEXT_LIGHT[name] || ACCENT_TEXT_LIGHT.cyan : hex
  writeAccent(el, accentSet(hex, ACCENT_2[name] || ACCENT_2.cyan, DARK_INK, text, light), light)
}

// Each flavour's CURATED signature accent — used when the accent mode is 'curated'
// instead of the deployed voice's accent. `dark` is the bright on-dark value;
// `light` is the deeper companion (also the gradient end / --accent-2); `ink` is the
// flavour's own dark ink, used on a filled accent wherever it reads better than white.
export const CURATED_ACCENT = {
  cultivar: { dark: '#3AD4C4', light: '#127E73', ink: '#06100D' },
  operator: { dark: '#E8A23B', light: '#8F5E10', ink: '#1A1306' },
  matrix: { dark: '#19E37C', light: '#0B7A47', ink: '#04140C' },
  // Atlas' sage, and the ink is the prototype's own #14200F rather than the shared
  // near-black: a sage fill wants a dark GREEN on it, not a neutral, or the primary
  // button reads as a sticker laid over the page instead of part of it.
  atlas: { dark: '#8FD694', light: '#1C8450', ink: '#14200F' },
}

// Write a flavour's curated accent on the app root (light reads the deeper
// companion). Returns false when the flavour has no curated entry, so the caller
// can fall back to the voice accent.
export function applyCuratedAccent(el, flavour, mode) {
  const c = CURATED_ACCENT[flavour]
  if (!el || !c) return false
  const light = mode === 'light'
  const fill = light ? c.light : c.dark
  writeAccent(el, accentSet(fill, c.light, c.ink, fill, light), light)
  return true
}

// ---- A colour picked freely (the accent picker's last choice) ----
// The fixed palette above carries hand-picked light companions and text colours; a free pick
// has none, so they are derived here to the same contract: the accent fill stands at 3:1
// against the page, accent text at 4.5:1 (WCAG AA), and the ink on a filled accent is
// whichever of near-black or white reads better. A pick too dark for the dark page is
// lightened, one too light for the pale page is darkened, in small steps toward
// white or black so the hue is kept.

// The real surfaces accent text must read on, copied from the .fl-* blocks in styles.css:
// `worst` is the lowest-contrast plain surface of any flavour in that mode (darkest light,
// lightest dark), `soft` the set of every flavour's --surface / --surface-2, which selected
// rows lay the 13% --accent-soft tint over. contrast.test.js derives both from the stylesheet
// and requires them to equal these exactly, so a copy that drifts from the CSS turns it red.
export const PAGES = {
  dark: {
    worst: '#232A31',
    soft: ['#14181D', '#1B2026', '#11151A', '#171C22', '#0B1116', '#121A21', '#1C1A12', '#211E15'],
  },
  light: {
    worst: '#EBE6D8',
    soft: ['#FBFDFC', '#F3F6F6', '#F4F6F8', '#E9F4ED', '#FCFAF4', '#F6F2E7'],
  },
}
const SOFT = 0.13 // --accent-soft: color-mix(in srgb, var(--accent) 13%, transparent)
const DARK_INK = '#06100D'

const toRgb = (hex) => {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}
const toHex = (rgb) =>
  '#' +
  rgb
    .map((v) => Math.round(v).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
const luminance = (hex) => {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const mix = (hex, target, t) => {
  const a = toRgb(hex)
  const b = toRgb(target)
  return toHex(a.map((v, i) => v + (b[i] - v) * t))
}
// Step `hex` toward `target` until it reaches `ratio` against every one of `pages`.
const reach = (hex, pages, ratio, target) => {
  const worst = (c) => Math.min(...[].concat(pages).map((p) => contrast(c, p)))
  let out = hex
  for (let t = 0.05; worst(out) < ratio && t <= 1.0001; t += 0.05) out = mix(hex, target, t)
  return out
}
// HSL hue (degrees) and saturation, for the warning shift below.
const hueSat = (hex) => {
  const [r, g, b] = toRgb(hex).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return { h: 0, s: 0 }
  const s = d / (1 - Math.abs(max + min - 1))
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: (h * 60 + 360) % 360, s }
}
const hueDist = (a, b) => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

// The one rule every accent source goes through. The ink is the darker candidate or white,
// whichever reads better on the fill; when neither reaches 4.5:1, the fill itself moves
// (darker on light, lighter on dark) until one does. The text colour starts from the source's
// own and darkens (light) or lightens (dark) only as far as the worst real surface and the
// soft tint require, so a value that already reads is written as it is.
function accentSet(fill, accent2, darkInk, text, light) {
  const toward = light ? '#000000' : '#FFFFFF'
  const inkOn = (f) => (contrast(f, darkInk) >= contrast(f, '#FFFFFF') ? darkInk : '#FFFFFF')
  const accent =
    contrast(fill, inkOn(fill)) >= 4.5
      ? fill
      : reach(fill, light ? '#FFFFFF' : darkInk, 4.5, toward)
  const p = light ? PAGES.light : PAGES.dark
  const bgs = [p.worst, ...p.soft.map((s) => mix(s, accent, SOFT))]
  return { accent, accent2, ink: inkOn(accent), text: reach(text, bgs, 4.5, toward) }
}

// VS-7: an accent in the amber band IS the warning colour, so under it every "needs a look"
// state reads as decoration. The warning then moves to the approved orange (--warn-text the
// same, darkened on light until it holds 4.5:1 on its own 15% tint); any other accent drops
// both overrides and the stylesheet's values apply again. Every flavour's --warn sits at hue
// 35-43, so 29 deg around 39 is "within 25 deg of some flavour's warn". The shift is skipped
// when the orange would sit no farther from the accent than the amber (a reddish accent).
const AMBER_HUE = 39
const ORANGE = { dark: ['#FF8A4C', '#FF8A4C'], light: ['#B4441F', '#9B3A1B'] } // [--warn, --warn-text]
function shiftWarn(el, accent, light) {
  const [warn, warnText] = light ? ORANGE.light : ORANGE.dark
  const { h, s } = hueSat(accent)
  const near = hueDist(h, AMBER_HUE)
  if (s >= 0.15 && near <= 29 && hueDist(h, hueSat(warn).h) > near) {
    el.style.setProperty('--warn', warn)
    el.style.setProperty('--warn-text', warnText)
  } else {
    el.style.removeProperty('--warn')
    el.style.removeProperty('--warn-text')
  }
}

function writeAccent(el, c, light) {
  el.style.setProperty('--accent', c.accent)
  el.style.setProperty('--accent-2', c.accent2)
  el.style.setProperty('--accent-ink', c.ink)
  el.style.setProperty('--accent-text', c.text)
  shiftWarn(el, c.accent, light)
}

export const isHexColour = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)

// The four values a free pick writes, per mode. Exported for the test that pins the ratios.
export function hexAccent(hex, mode) {
  const light = mode === 'light'
  const p = light ? PAGES.light : PAGES.dark
  const toward = light ? '#000000' : '#FFFFFF'
  const fill = reach(hex, p.worst, 3, toward)
  return accentSet(fill, reach(fill, p.worst, 4.5, toward), DARK_INK, fill, light)
}

export function applyHexAccent(el, hex, mode) {
  if (!el || !isHexColour(hex)) return false
  writeAccent(el, hexAccent(hex, mode), mode === 'light')
  return true
}
