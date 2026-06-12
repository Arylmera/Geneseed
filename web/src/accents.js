// ANSI accent name (a theme's ACCENT field) -> Cultivar UI palette. The single
// source for live theming, the theme gallery, and the voice popover.
export const ACCENT_HEX = {
  red: '#FF5C57', green: '#4ED888', yellow: '#E8B53D', blue: '#5B8CFF',
  magenta: '#C77DFF', cyan: '#3AD4C4', white: '#E9EFEA',
}

// Darker companion per accent (gradient ends, light-mode reads this as the base).
export const ACCENT_2 = {
  red: '#C53A36', green: '#2FA864', yellow: '#B8862A', blue: '#3C66D8',
  magenta: '#9A52D6', cyan: '#2BA89B', white: '#AEB8B0',
}

export const accentHex = (name) => ACCENT_HEX[name] || ACCENT_HEX.cyan

// Readable text on a filled accent.
export const accentInk = (name) =>
  (name === 'yellow' || name === 'white' || name === 'cyan' || name === 'green')
    ? '#06100D' : '#FFFFFF'

// Set the live accent on the app root. Light mode reads the deeper companion so
// small text and strokes stay legible on a pale surface; the 'white' accent is
// unusable on light and falls back to slate.
export function applyAccent(el, name, mode) {
  if (!el) return
  const light = mode === 'light'
  let hex = light ? (ACCENT_2[name] || ACCENT_2.cyan) : accentHex(name)
  let ink = light ? '#FFFFFF' : accentInk(name)
  if (light && name === 'white') { hex = '#566B62'; ink = '#FFFFFF' }
  el.style.setProperty('--accent', hex)
  el.style.setProperty('--accent-2', ACCENT_2[name] || ACCENT_2.cyan)
  el.style.setProperty('--accent-ink', ink)
}
