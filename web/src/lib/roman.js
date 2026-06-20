// Roman numeral → Arabic integer. Returns NaN for anything that isn't a valid Roman
// numeral, so callers can fall back to the raw value. Shared by the Laws table (keying
// LAW_META, padding the displayed numeral) and the Graph (sorting law nodes by numeral).
export const ROMAN_VALUES = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }

export function romanToInt(raw) {
  if (!raw) return NaN
  const s = String(raw).toUpperCase()
  if (!/^[IVXLCDM]+$/.test(s)) return NaN
  let total = 0
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN_VALUES[s[i]]
    const next = ROMAN_VALUES[s[i + 1]]
    total += next && next > v ? -v : v
  }
  return total
}
