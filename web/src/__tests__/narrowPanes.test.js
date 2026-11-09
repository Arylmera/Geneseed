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

  // Design "A, toolbar" (user, 2026-11-09). Stacked, `.library` is no longer one grid card whose
  // rows stretch to its min-height (the empty gaps of #512): it is a flex column of blocks, each
  // as tall as its content, on the page's own background. Every rule below exists once per tier:
  // the three panes', and the locked Library's at its own width.
  const STACKS = [
    ['three panes', threePane, '.lib-wrap .library:not(.locked)'],
    ['a locked Library', twoPane, '.lib-wrap .library.locked'],
  ]

  it('stacks below the width that leaves the reader 560px beside the rail and the list', () => {
    expect(rule('.lib-wrap .library:not(.locked)', threePane())).toMatch(/display:\s*flex/)
    // The three-pane tier leaves a locked Library alone: it has room down to its own tier.
    expect(threePane()).not.toMatch(/\.library\.locked/)
  })

  it('a locked Library stacks below the width that leaves the reader 560px beside the list', () => {
    expect(rule('.lib-wrap .library.locked', twoPane())).toMatch(/display:\s*flex/)
  })

  // Outside the tiers the toolbar's own rows and the picker's header are hidden and both
  // wrappers lay out as if absent, so the wide panes are as before.
  it('outside the stack, the toolbar rows and the picker header are hidden, the wrappers unwrapped', () => {
    expect(rule('.lib-seg, .lib-chips, .lib-list-toggle')).toMatch(/display:\s*none/)
    expect(rule('.lib-toolbar, .lib-toolbar-filter, .lib-picker')).toMatch(/display:\s*contents/)
  })

  // Measured in the preview (2026-11-09): useActiveRowInView (LibRows.jsx) reads a row's
  // offsetTop as its place inside the scroller, so the scroller is the rows' offset parent.
  it('the list scroller is the offset parent its rows are measured from', () => {
    expect(rule('.lib-rows')).toMatch(/position:\s*relative/)
  })

  it('in the three-pane stack the rail gives way to the segmented control and the chips', () => {
    const tier = threePane()
    expect(rule('.lib-wrap .lib-kinds .kind-list', tier)).toMatch(/display:\s*none/)
    const x = '.lib-wrap .library:not(.locked)'
    expect(rule(`${x} .lib-seg`, tier)).toMatch(/display:\s*grid/)
    expect(rule(`${x} .lib-chips`, tier)).toMatch(/display:\s*block/)
    // The looks live outside the tiers: a hidden or display: contents box draws none of them.
    // Two to four sections fill the track, wrapping where they would not fit.
    expect(rule('.lib-seg')).toMatch(/grid-template-columns:\s*repeat\(auto-fit, minmax\(/)
    expect(rule('.lib-seg a.on')).toMatch(/background:\s*var\(--accent\)/)
    expect(rule('.lib-chips .rail-mix')).toMatch(/display:\s*none/)
  })

  for (const [name, tierOf, x] of STACKS) {
    // No block keeps a height its content does not fill: no min-height left from the grid, the
    // blocks start at the top, and the list head (its label and count are the segmented
    // control's and the picker's now) is display: none when nothing else is left in it, since a
    // flex gap still counts an empty box.
    it(`in the stack of ${name}, every block is as tall as its content`, () => {
      const tier = tierOf()
      const lib = rule(x, tier)
      expect(lib).toMatch(/flex-direction:\s*column/)
      expect(lib).toMatch(/min-height:\s*0/)
      expect(rule(`${x} .lib-list`, tier)).toMatch(/display:\s*flex/)
      expect(rule(`${x} .lib-list-head > b`, tier)).toMatch(/display:\s*none/)
      expect(rule(`${x} .lib-list-head:not(:has(> :not(b):not(:empty)))`, tier)).toMatch(
        /display:\s*none/,
      )
    })

    it(`in the stack of ${name}, the toolbar, the picker and the entry are three cards`, () => {
      const tier = tierOf()
      // The toolbar and the picker carry their card outside the tiers (display: contents there
      // draws none of it); the entry, a real box side by side too, gets its card in the tier.
      for (const card of ['.lib-toolbar', '.lib-picker'])
        expect(rule(card)).toMatch(/border:\s*1px solid var\(--line\)/)
      expect(rule(`${x} .lib-toolbar, ${x} .lib-toolbar-filter`, tier)).toMatch(/display:\s*flex/)
      expect(rule(`${x} .lib-picker`, tier)).toMatch(/display:\s*block/)
      expect(rule(`${x} .lib-reader`, tier)).toMatch(/border:\s*1px solid var\(--line\)/)
      expect(rule(`${x} .lib-list-toggle`, tier)).toMatch(/display:\s*flex/)
    })

    // A closed picker hides its rows (display: none, so they take no height); the cap is five
    // rows, and a row's height is derived from the parts the row is drawn with.
    it(`in the stack of ${name}, the picker folds its rows and shows five before it scrolls`, () => {
      const tier = tierOf()
      expect(rule(`${x} .lib-list[data-open="false"] .lib-rows`, tier)).toMatch(/display:\s*none/)
      expect(rule(`${x} .lib-rows`, tier)).toMatch(/max-height:\s*calc\(5 \* var\(--lib-row-h\)\)/)
    })
  }

  it('a row height is the sum of the parts the row is drawn with', () => {
    const lib = rule('.library')
    expect(lib).toMatch(/--lib-row-pad:\s*10px/)
    expect(lib).toMatch(/--lib-row-gap:\s*3px/)
    expect(lib).toMatch(
      /--lib-row-h:\s*calc\(2 \* var\(--lib-row-pad\) \+ var\(--lib-row-gap\) \+ 2px \+ 1px \+ var\(--lh-body\) \* \(var\(--fs-md\) \+ var\(--fs-sm\)\)\)/,
    )
    const row = rule('.library .lib-row')
    expect(row).toMatch(/padding:\s*var\(--lib-row-pad\) 18px/)
    expect(row).toMatch(/gap:\s*var\(--lib-row-gap\)/)
    expect(rule('body')).toMatch(/line-height:\s*var\(--lh-body\)/)
    expect(rule('.library .lr-desc')).toMatch(/font-size:\s*var\(--fs-sm\)/)
    expect(rule('.lib-row .lr-name')).toMatch(/font-size:\s*var\(--fs-md\)/)
    expect(rule('.lib-row .lr-desc')).toMatch(/margin-top:\s*2px/)
    expect(rule('.lib-row')).toMatch(/border-bottom:\s*1px solid/)
  })

  // With usage on, the Library hides the line of description, so its row is shorter: measured
  // 2026-11-09, 42.7px against 67.85px, so the 5-row cap showed seven. Its height drops the
  // description's line, its 2px and the gap.
  it('a row with its description hidden drops that line from its height', () => {
    expect(rule('.lib-dossier.uses .lr-desc')).toMatch(/display:\s*none/)
    expect(rule('.lib-dossier.uses')).toMatch(
      /--lib-row-h:\s*calc\(2 \* var\(--lib-row-pad\) \+ 1px \+ var\(--lh-body\) \* var\(--fs-md\)\)/,
    )
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
