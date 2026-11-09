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
  const threePane = () => {
    const cols = /grid-template-columns:\s*(\d+)px minmax\(0, (\d+)px\)/.exec(rule('.library'))
    return tierAt(
      `@container lib (max-width: ${Number(cols[1]) + Number(cols[2]) + 560 + 2 - 1}px) {`,
    )
  }
  // A locked Library (Personal › Memory, Notebook) has no rail: the list and the reader only,
  // so it keeps both side by side down to the list's width + 560 + 2.
  const twoPane = () => {
    const cols = /grid-template-columns:\s*minmax\(0, (\d+)px\)/.exec(rule('.library.locked'))
    return tierAt(`@container lib (max-width: ${Number(cols[1]) + 560 + 2 - 1}px) {`)
  }

  it('stacks below the width that leaves the reader 560px beside the rail and the list', () => {
    expect(rule('.lib-wrap .library:not(.locked)', threePane())).toMatch(
      /grid-template-columns:\s*minmax\(0, 1fr\)/,
    )
    // The three-pane tier leaves a locked Library alone: it has room down to its own tier.
    expect(threePane()).not.toMatch(/\.library\.locked/)
  })

  it('a locked Library stacks below the width that leaves the reader 560px beside the list', () => {
    const tier = twoPane()
    expect(rule('.lib-wrap .library.locked', tier)).toMatch(
      /grid-template-columns:\s*minmax\(0, 1fr\)/,
    )
    expect(rule('.lib-wrap .library.locked .lib-rows', tier)).toMatch(/max-height:\s*45vh/)
    expect(rule('.lib-wrap .library.locked .lib-reader', tier)).toMatch(/grid-column:\s*auto/)
  })

  // Reading order is the DOM's: the section header, the panels, the list, the entry.
  it('in the stack the panels wrap full width, the list scrolls inside a cap, the entry follows', () => {
    const tier = threePane()
    const kinds = rule('.lib-wrap .kind-list', tier)
    expect(kinds).toMatch(/display:\s*flex/)
    expect(kinds).toMatch(/flex-wrap:\s*wrap/)
    expect(kinds).toMatch(/overflow:\s*visible/)
    expect(rule('.lib-wrap .rail-cats', tier)).toMatch(/flex-basis:\s*100%/)
    expect(rule('.lib-wrap .library:not(.locked) .lib-rows', tier)).toMatch(/max-height:\s*45vh/)
    expect(rule('.lib-wrap .library:not(.locked) .lib-reader', tier)).toMatch(/grid-column:\s*auto/)
  })

  // At a 673–720px window the page is wider than 640px, so a container tier for the phone
  // padding never matched there and the 24px 20px stacked padding beat the phone's 20px 16px.
  // The phone padding is a media rule after the container tiers, as specific as their reader.
  it('the phone reader padding wins over the stacked padding at every phone width', () => {
    const at = css.indexOf('@media (max-width: 720px) {\n  .lib-wrap')
    expect(at).toBeGreaterThan(css.indexOf('@container lib (max-width:'))
    const phone = css.slice(at, css.indexOf('\n}\n', at))
    expect(
      rule(
        '.lib-wrap .library:not(.locked) .lib-reader, .lib-wrap .library.locked .lib-reader',
        phone,
      ),
    ).toMatch(/padding:\s*20px 16px/)
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

  // Measured 2026-11-09 at 420px: an agent body's inline `C:/Users/…/<your-name>.md` path drew
  // 409px in a 386px reader.
  it('an inline code token too long for the line breaks anywhere', () => {
    expect(rule('.lib-wrap .lib-reader .detail-doc .markdown code')).toMatch(
      /overflow-wrap:\s*anywhere/,
    )
  })

  // A ring fills its pane up to its own width (`--loop-w`, RingGraph), never past it: the old
  // 680px cap drew a wider ring (825px) at 0.82 even on a wide pane, its labels under 11px.
  it('a loop ring is capped at its own drawn width, not at a fixed 680px', () => {
    const ring = rule('.loop-ring')
    expect(ring).toMatch(/max-width:\s*var\(--loop-w/)
    expect(ring).not.toMatch(/max-width:\s*680px/)
  })

  // The label floor: an 11.5px node label stays at 11px or more while the ring is drawn at
  // 11 / 11.5 of its own width or wider. Measured 2026-11-09 at 960px: "How it runs" beside the
  // ring left it 6.6px labels in an 839px reader. So the ring claims that width first, "How it
  // runs" wraps under it, and only a pane narrower than that shrinks the labels.
  it('a ring keeps the width that holds its labels at 11px before "How it runs" sits beside it', () => {
    const graph = rule('.loop-console .loop-graph')
    expect(graph).toMatch(/flex:\s*999 1 0/)
    expect(graph).toMatch(/min-width:\s*min\(calc\(var\(--loop-w, 420px\) \* 11 \/ 11\.5\), 100%\)/)
  })
})

// A side panel beside a page's content (the Constitution's packs and gates, `.split`; the Docs
// map's piece panel, `.docs-map`) sits beside the content while the content keeps its floor,
// and wraps under it, full width, once it would not: the intrinsic "sidebar" layout (the content
// grows 999 times faster, the panel keeps its basis). It reads the room the page gives, so it
// needs no viewport breakpoint, and has none left.
describe('side panels wrap under the content', () => {
  it('the Constitution: the rules keep 560px, the packs panel 340px, then it wraps', () => {
    expect(rule('.split')).toMatch(/flex-wrap:\s*wrap/)
    expect(rule('.split > .panel')).toMatch(/flex:\s*999 1 0/)
    expect(rule('.split > .panel')).toMatch(/min-width:\s*min\(560px, 100%\)/)
    expect(rule('.aside-stack')).toMatch(/flex:\s*1 1 340px/)
    expect(css).not.toMatch(/\.split \{ flex-direction: column/)
  })

  it('the Docs map: the pieces keep 360px, the piece panel 280px, then it wraps', () => {
    expect(rule('.docs-map')).toMatch(/flex-wrap:\s*wrap/)
    expect(rule('.docs-map > .map-tree')).toMatch(/flex:\s*999 1 0/)
    expect(rule('.docs-map > .map-tree')).toMatch(/min-width:\s*min\(360px, 100%\)/)
    expect(rule('.docs-map > .map-detail')).toMatch(/flex:\s*1 1 280px/)
    expect(css).not.toMatch(/\.docs-map \{ grid-template-columns: 1fr; \}/)
  })
})
