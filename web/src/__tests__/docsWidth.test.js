import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// jsdom lays nothing out, so this pins the docs reader's width by arithmetic on the rules
// themselves: the page gets the viewport minus the 248px rail and 2 x 34px page padding. From
// 869px of page the parts and the list share one nav column beside the reader, and the article
// gets what that column and the reader's padding (both sides) leave over; from 1154px of page
// the margin stands beside the article too, taking its column and the reading grid's gap. All
// of those numbers are read from the rules, never copied here. The rule it pins: from a 1366px
// window up, the article is never under 600px. The bug it guards was 173px of article at 1440px.
const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')

const tier = (head) => {
  const at = css.indexOf(head)
  expect(at, `missing ${head}`).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('\n}\n', at))
}
const px = (s) => [...s.matchAll(/(\d+)px/g)].map((m) => Number(m[1]))

const nav = tier('@container docs (min-width: 869px) {')
const wide = tier('@container docs (min-width: 1154px) {')

function article(vw) {
  const page = vw - 248 - 68 - 2 // rail, page padding, the library's border
  if (page < 869) return null
  const [col] = px(nav.match(/\.library\.docs-lib \{[^}]*\}/)[0])
  const [pad] = px(nav.match(/\.docs-lib \.lib-reader \{[^}]*\}/)[0])
  const reading = page - col - 2 * pad
  if (page < 1154) return reading
  const [margin] = px(wide.match(/\.docs-read \{[^}]*\}/)[0])
  const gap = Number(css.match(/\.docs-read \{ display: grid;[^}]*gap: (\d+)px/)[1])
  return reading - margin - gap
}

describe('docs reader width', () => {
  it.each([1366, 1440, 1600, 1728, 1920])('leaves the article at least 600px at %ipx', (vw) => {
    expect(article(vw)).toBeGreaterThanOrEqual(600)
  })
  // The widths as designed: 1366 and 1440 read the one-column tier, 1600 up the wide one, with
  // a 260px nav column, 28px reader padding, a 210px margin and a 28px gap. A wrong tier switch
  // or a resized column (a 320px nav still clears 600) moves these values, so this row reddens.
  it('reads the tier each window falls in', () => {
    expect([1366, 1440, 1600, 1728, 1920].map(article)).toEqual([732, 806, 728, 856, 1048])
  })
  it('sets the margin beside the article only in the wide tier', () => {
    expect(wide).toMatch(/\.docs-read \{ grid-template-columns: minmax\(0, 1fr\) 210px; \}/)
    expect(css).toMatch(/\.docs-read \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/)
  })
  it('makes the docs wrapper the size container the tiers query', () => {
    expect(css).toMatch(/\.docs-wrap \{ container: docs \/ inline-size; \}/)
  })
})
