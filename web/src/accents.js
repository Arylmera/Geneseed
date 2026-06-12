// ANSI accent name (a theme's ACCENT field) -> UI hex. Same palette as the
// CSS swatches; the single source the live theming and the gallery both use.
export const ACCENT_HEX = {
  red: '#f85149', green: '#3fb950', yellow: '#d29922', blue: '#5b8cff',
  magenta: '#bc8cff', cyan: '#39c5cf', white: '#e6e8ee',
}

// Button/label text that stays readable on the accent: dark on light accents.
export const accentContrast = (name) =>
  (name === 'white' || name === 'yellow' ? '#0f1117' : '#ffffff')

export const accentHex = (name) => ACCENT_HEX[name] || ACCENT_HEX.cyan
