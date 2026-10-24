import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// The Constitution tier cells for Dictates and Doctrines are <button>s (they filter the table).
// A <button> keeps the browser's own skin — a light-grey fill and centred text — unless the
// stylesheet resets it; in dark mode that hid the light tier names (reported 2026-10-25).
// This reads the real stylesheet: the reset must exist and must clear the fill.
const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')

describe('Constitution tier buttons', () => {
  it('reset the browser button skin: transparent fill, left-aligned, inherited font', () => {
    const rule = css.match(/button\.tier\s*\{([^}]*)\}/)
    expect(rule, 'no button.tier rule in styles.css').not.toBeNull()
    expect(rule[1]).toMatch(/background:\s*transparent/)
    expect(rule[1]).toMatch(/text-align:\s*left/)
    expect(rule[1]).toMatch(/font:\s*inherit/)
  })
})
