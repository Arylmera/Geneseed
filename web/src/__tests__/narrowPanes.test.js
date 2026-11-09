import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// jsdom evaluates no @container query, so this pins the narrow tier of the Library's three panes
// (Library, Loops, Factories) from the rules themselves, as lawsColumns.test.js does. What the
// stacked panes then look like is checked in a browser only.
const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')
// A rule whose selector list starts the line, so `.loop-ring` is not found inside
// `.loop-graph.flow .loop-ring`.
const rule = (sel, from = css) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const at = from.search(new RegExp(`\\n\\s*${esc} \\{`))
  expect(at, `missing ${sel}`).toBeGreaterThan(-1)
  return from.slice(at, from.indexOf('}', at))
}
const tierAt = (head) => {
  const at = css.indexOf(head)
  expect(at, `missing ${head}`).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('\n}\n', at))
}

describe('Library panes: the narrow tier', () => {
  it('the wrapper around .library is the `lib` size container', () => {
    expect(rule('.lib-wrap')).toMatch(/container:\s*lib \/ inline-size/)
  })

  // The threshold is derived, not typed: the rail and the list keep their widths from the base
  // rule, the reader keeps 560px, and the 1px border sits on each side. Below that sum the
  // three panes stack, so the reader never shares a row narrower than 560px.
  it('stacks below the width that leaves the reader 560px beside the rail and the list', () => {
    const cols = /grid-template-columns:\s*(\d+)px minmax\(0, (\d+)px\)/.exec(rule('.library'))
    const fits = Number(cols[1]) + Number(cols[2]) + 560 + 2
    const tier = tierAt(`@container lib (max-width: ${fits - 1}px) {`)
    expect(rule('.lib-wrap .library, .lib-wrap .library.locked', tier)).toMatch(
      /grid-template-columns:\s*minmax\(0, 1fr\)/,
    )
  })

  // Reading order is the DOM's: the section header, the panels, the list, the entry.
  it('in the stack the panels wrap full width, the list scrolls inside a cap, the entry follows', () => {
    const tier = tierAt('@container lib (max-width:')
    const kinds = rule('.lib-wrap .kind-list', tier)
    expect(kinds).toMatch(/display:\s*flex/)
    expect(kinds).toMatch(/flex-wrap:\s*wrap/)
    expect(kinds).toMatch(/overflow:\s*visible/)
    expect(rule('.lib-wrap .rail-cats', tier)).toMatch(/flex-basis:\s*100%/)
    expect(rule('.lib-wrap .library .lib-rows', tier)).toMatch(/max-height:\s*45vh/)
    const reader = '.lib-wrap .library .lib-reader, .lib-wrap .library.locked .lib-reader'
    expect(rule(reader, tier)).toMatch(/grid-column:\s*auto/)
  })
})

describe('the entry reader never scrolls sideways', () => {
  it('a start command wraps, breaking a long token anywhere', () => {
    const pre = rule('.loop-start pre')
    expect(pre).toMatch(/white-space:\s*pre-wrap/)
    expect(pre).toMatch(/overflow-wrap:\s*anywhere/)
    expect(pre).not.toMatch(/overflow-x/)
  })

  it("a code block in the Library family's reader wraps too", () => {
    const pre = rule('.lib-wrap .lib-reader .detail-doc .markdown pre')
    expect(pre).toMatch(/white-space:\s*pre-wrap/)
    expect(pre).toMatch(/overflow-wrap:\s*anywhere/)
  })

  // A ring fills its pane up to its own width (`--loop-w`, RingGraph), never past it: the old
  // 680px cap drew a wider ring (825px) at 0.82 even on a wide pane, its labels under 11px.
  it('a loop ring is capped at its own drawn width, not at a fixed 680px', () => {
    const ring = rule('.loop-ring')
    expect(ring).toMatch(/max-width:\s*var\(--loop-w/)
    expect(ring).not.toMatch(/max-width:\s*680px/)
  })
})
