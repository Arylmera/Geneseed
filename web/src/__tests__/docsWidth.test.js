import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// jsdom lays nothing out, so this pins the docs reader's width by arithmetic on the rules
// themselves: the page gets the viewport minus the 248px rail and 2 x 34px page padding, and
// in each container tier the article gets what the panes, the reader's padding and (wide tier
// only) the 210px margin + 28px gap leave over. The rule it pins: from a 1366px window up,
// the article is never under 600px. The bug it guards was 173px of article at 1440px.
const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')

const tier = (head) => {
  const at = css.indexOf(head)
  expect(at, `missing ${head}`).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('\n}\n', at))
}
const px = (s) => [...s.matchAll(/(\d+)px/g)].map((m) => Number(m[1]))

const wide = tier('@container docs (min-width: 1422px)')
const mid = tier('@container docs (min-width: 869px) and (max-width: 1421.98px)')

function article(vw) {
  const page = vw - 248 - 68 - 2 // rail, page padding, the library's border
  if (page >= 1422) {
    const [rail, list] = px(wide.match(/\.library\.docs-lib \{[^}]*\}/)[0])
    return page - rail - list - 72 - 210 - 28
  }
  if (page >= 869) {
    const [col] = px(mid.match(/\.library\.docs-lib \{[^}]*\}/)[0])
    const [pad] = px(mid.match(/\.docs-lib \.lib-reader \{[^}]*\}/)[0])
    return page - col - 2 * pad
  }
  return null
}

describe('docs reader width', () => {
  it.each([1366, 1440, 1600, 1728, 1920])('leaves the article at least 600px at %ipx', (vw) => {
    expect(article(vw)).toBeGreaterThanOrEqual(600)
  })
  it('sets the margin beside the article only in the wide tier', () => {
    expect(wide).toMatch(/\.docs-read \{ grid-template-columns: minmax\(0, 1fr\) 210px; \}/)
    expect(css).toMatch(/\.docs-read \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/)
  })
  it('makes the docs wrapper the size container the tiers query', () => {
    expect(css).toMatch(/\.docs-wrap \{ container: docs \/ inline-size; \}/)
  })
})
