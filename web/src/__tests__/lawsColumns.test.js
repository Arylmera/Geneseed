import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// jsdom places no grid item, so this pins the Constitution table's Enforced by track from the
// rules themselves. In a wrap with switches the templates end `… Rule text, Enforced by, Hook
// gate`, and a row or header with no switch cells (the Ethos band, a retired Dictate) has only
// five cells: auto-placement would put its Enforced by in the Rule text track. So every
// Enforced by cell of such a wrap is pinned to `grid-column: -3`, the second track from the end,
// which must be Enforced by's in every template that holds it. Below 760 the column is hidden and
// its track dropped. Whether the cells then line up is checked in a browser only.
const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')
const rule = (sel) => {
  const at = css.indexOf(`${sel} {`)
  expect(at, `missing ${sel}`).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('}', at))
}
const secondLast = (body, prop) => {
  const v = new RegExp(`${prop}:\\s*([^;]+);`)
    .exec(body)[1]
    .trim()
    .split(/\s+(?![^(]*\))/)
  return v[v.length - 2]
}

describe('Constitution table: the Enforced by track', () => {
  it('pins Enforced by to the second track from the end in a wrap with switches', () => {
    expect(rule('.law-wrap.with-toggle [data-col="enf"]')).toMatch(/grid-column:\s*-3/)
  })

  it('every template with switches holds Enforced by second from the end', () => {
    const wrap = '.law-wrap.with-toggle .law-rowhead, .law-wrap.with-toggle .law-row'
    expect(secondLast(rule(wrap), '--law-cols')).toBe('var(--law-enf)')
    expect(secondLast(rule('.law-row.has-toggle'), 'grid-template-columns')).toBe('var(--law-enf)')
  })

  it('below 760 the column is hidden and both switch templates drop its track', () => {
    const at = css.indexOf('@container laws (max-width: 759px) {')
    const tier = css.slice(at, css.indexOf('\n}\n', at))
    expect(tier).toMatch(/\[data-col="enf"\] \{ display: none; \}/)
    expect(tier).not.toMatch(/--law-enf/)
    expect(tier).toMatch(
      /\.law-row\.has-toggle \{ grid-template-columns: minmax\(0, 1fr\) var\(--law-tog\) var\(--law-tog\); \}/,
    )
  })
})
