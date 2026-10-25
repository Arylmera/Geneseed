import React from 'react'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The Constitution page had NO component test before this file — its only gate was doctor's
// parity check on its principle table, which knew nothing about what renders. So the claims
// here are the ones a server-side gate structurally cannot make: that all three tiers reach the
// DOM, that a pack which is not built in is visible rather than absent, and that each of the
// three address shapes deep-links to the right row.

vi.mock('../api/index.js', () => ({
  api: { catalog: vi.fn(), item: vi.fn(), rules: vi.fn(() => Promise.resolve(null)) },
}))

// Every confirm answers yes, and the questions a page asked are read off
// `askConfirm.mock.calls` (hooks/useConfirm.jsx; its own dialog is tested in useConfirm.test).
const { askConfirm } = vi.hoisted(() => ({ askConfirm: vi.fn(async () => true) }))
vi.mock('../hooks/useConfirm.jsx', () => ({ useConfirm: () => askConfirm }))
// The confirm is a promise, so the action behind it lands a microtask after the click.
const answered = () => act(async () => {})

import Laws from '../pages/Laws.jsx'
import { api } from '../api/index.js'
import { clearAsyncCache } from '../hooks/useAsync.js'

const ONT = ['telos', 'evidence', 'decisions', 'conduct'].map((id) => ({
  name: `ont:${id}`,
  title: id[0].toUpperCase() + id.slice(1),
  desc: '',
  tier: 'ontology',
}))

const INV = [
  ['I', 'Sealed Secrets', 'security'],
  ['II', 'One Intent, One Act', 'process'],
  ['III', 'Verify Before Asserting', 'verify'],
].map(([num, title, klass]) => ({
  name: num,
  title: `Rule ${num} — ${title}`,
  desc: '',
  klass,
  tier: 'invariant',
}))

/**
 * Three packs covering the three states the doctrine band exists to tell apart:
 *
 *   craft   — built in, with ONE of its three rules excluded (the per-rule axis)
 *   process — built in whole, and it carries the consent gate (`process 5`)
 *   ops     — not built in at all (the greyed pack)
 *
 * ⚠ TWO FLAGS PER ROW, not one. `active` is the RULE's own and `packActive` is its pack's;
 * craft.3 is the pair that can disagree, and reading a pack's state off its first rule (or a
 * rule's off its pack) is exactly the bug that pair is here to catch.
 */
const DOC = [
  [
    'craft',
    'Craft',
    'how code is written',
    true,
    [
      [1, 'Automate Repetition', true],
      [2, 'English Configuration', true],
      [3, 'Documentation in Step', false],
    ],
  ],
  [
    'process',
    'Process',
    'how a task is run',
    true,
    [
      [5, 'Consent Before Push', true],
      [7, 'Codes That Persist', true],
    ],
  ],
  [
    'ops',
    'Ops',
    'how the machine is operated',
    false,
    [
      [1, 'Tool Discovery', false],
      [2, 'Commands Must Return', false],
    ],
  ],
].flatMap(([pack, packTitle, packDesc, packActive, rules]) =>
  rules.map(([n, title, active]) => ({
    name: `${pack}.${n}`,
    title: `Doctrine ${pack} ${n} — ${title}`,
    desc: '',
    klass: pack,
    tier: 'doctrine',
    pack,
    packTitle,
    packDesc,
    active,
    packActive,
  })),
)

const PAYLOAD = { section: 'laws', items: [...ONT, ...INV, ...DOC] }

beforeEach(() => {
  vi.clearAllMocks()
  // A rule body is memoised by address now (CatalogRow's `law-item` key): one case's body must
  // not answer the next. setup.js clears it too; this keeps the file's claim local.
  clearAsyncCache()
  api.catalog.mockResolvedValue(PAYLOAD)
  api.item.mockResolvedValue({ body: 'The canonical text of this entry.' })
})

describe('Constitution page', () => {
  it('renders every tier as a band in reading order, and ranks them by precedence', async () => {
    // Queried by the band HEADINGS: the order is the claim, since this page is read top to
    // bottom. The doctrine tier is one band per pack, each headed by its (themed) title. The
    // bands are READING order (the character first, then the rules it serves); the RANK lives
    // in the tier strip, which follows the Precedence table of src/AGENT.md.tmpl.
    //
    // THE FIRST BAND READS `Ethos`, NOT `Ontology`. The tier is a character rather than a
    // taxonomy, so the noun a reader sees was renamed; the address under it (the route, the
    // `ontology/universal.md` source line, `counts.ontology`) did not move.
    const { container } = render(<Laws />)
    await waitFor(() => expect(container.querySelector('.band-head')).toBeTruthy())
    expect([...container.querySelectorAll('.band-head .tier-h')].map((h) => h.textContent)).toEqual(
      ['Ethos', 'Dictates', 'Craft', 'Process', 'Ops'],
    )
    // The tier strip ranks the four tiers by the Precedence table: Dictates, then your own
    // rules, then the Ethos, then the Doctrines. Each cell says how it stands against the rank
    // above it. Your rules link to Personal. The page once printed "TIER 1 Ethos" and "a higher
    // tier always wins", which taught the reverse of the real order.
    const cells = [...container.querySelectorAll('.tier')].map((t) => [
      t.querySelector('.tier-k').textContent,
      t.querySelector('.tier-name').textContent,
      t.querySelector('.tier-rule').textContent,
    ])
    expect(cells).toEqual([
      ['RANK 1', 'Dictates', 'Nothing outranks them.'],
      ['RANK 2', 'Your rules', 'May tighten a Dictate, never repeal one.'],
      ['RANK 3', 'Ethos', 'Never against a user rule.'],
      ['RANK 4', 'Doctrines', 'May tighten, never repeal.'],
    ])
    expect(container.querySelector('a.tier').getAttribute('href')).toBe('#/personal/rules')
    expect(container.textContent).not.toMatch(/higher tier always wins/i)
    // Numbers are positional and the retired rules were removed, so this note was false.
    expect(container.textContent).not.toMatch(/keep their number/)
    // ...and the entries themselves, the address prefix stripped off the display name: the
    // row shows the rule's NAME, not `Doctrine craft 1 — Automate Repetition`.
    expect(screen.getByText('Telos')).toBeTruthy()
    expect(screen.getByText('Sealed Secrets')).toBeTruthy()
    expect(screen.getByText('Automate Repetition')).toBeTruthy()
  })
  // Ethos sits above the tabs and the filter and neither reaches it: its sections are the
  // character the rules serve, not rules to narrow down. So "All" counts only what the filter
  // can reach (3 invariants + the fixture's doctrine rules), and Telos survives a tab switch
  // and a filter that matches nothing in it.
  it('keeps Ethos above the filter zone, outside the tabs and the filter', async () => {
    const { container } = render(<Laws />)
    await waitFor(() => expect(screen.getByText('Telos')).toBeTruthy())
    const panel = container.querySelector('.law-wrap')
    const firstBand = panel.querySelector('.band-head .tier-h')
    expect(firstBand.textContent).toBe('Ethos')
    expect(
      firstBand.compareDocumentPosition(panel.querySelector('.law-toolbar')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    const all = screen.getByRole('button', { name: /^All/ })
    expect(all.textContent).toBe(`All ${INV.length + DOC.length}`)
    fireEvent.click(screen.getByRole('button', { name: /^Dictates/ }))
    expect(screen.getByText('Telos')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filter rules'), { target: { value: 'Sealed' } })
    expect(screen.getByText('Telos')).toBeTruthy()
    expect(screen.getByText('Sealed Secrets')).toBeTruthy()
  })

  it('shows a pack that is not built in, greyed, with the command to enable it', async () => {
    // ⚠ THE CLAIM THIS PAGE EXISTS FOR. An inactive pack that were simply omitted would make
    // "off" indistinguishable from "never shipped" — and the enable command has to name the
    // WHOLE selection, because `--doctrines` replaces the set rather than adding to it.
    //
    // This is the no-install case: with one to rebuild, the switches take over and the command
    // is not shown at all (see the toggle suite below).
    const { container } = render(<Laws />)
    await settled(container)
    expect(screen.getByText(/not built in/)).toBeTruthy()
    expect(container.querySelector('.pack-wrap.pack-off')).toBeTruthy()
    // ⚠ `geneseed-build`, NOT `geneseed build`. The CLI's `build` verb forwards `--theme` and
    // nothing else, so the shorter spelling errors with `unrecognized arguments` — this page
    // shipped that wrong command in 3.0.0, the same trap DESIGN.md documents for
    // `--sync-themes`.
    const cmd = screen.getByText(/geneseed-build --doctrines/)
    expect(cmd.textContent).toContain('craft,process,ops')
    // ...and it carries the SECOND axis too, or running it would hand back the one rule this
    // install excludes. `--doctrines` replaces the pack set; `--exclude-rules` replaces the
    // rule set, and a command that named only the first silently re-enables craft 3.
    expect(cmd.textContent).toContain('--exclude-rules craft.3')
    // Its rules are still listed and still readable — the text ships either way.
    expect(screen.getByText('Tool Discovery')).toBeTruthy()
    // The active packs are NOT marked off, or the marker means nothing.
    expect(container.querySelectorAll('.pack-wrap').length).toBe(3)
    expect(container.querySelectorAll('.pack-wrap.pack-off').length).toBe(1)
  })

  it('states each rule’s status and what enforces it', async () => {
    // Status is Active or Retired; "Enforced by" is Hook gate for the rules a hook
    // enforces (lib/constitution.js HOOK_GATED, gated against the doctor's HOOK_PINNED;
    // Law III by the Stop-hook done gate) and Instruction for the rest. The Latin name is the voice's half of
    // the title, and a title without one leaves the column empty.
    api.catalog.mockResolvedValue({
      section: 'laws',
      items: [
        ...INV,
        {
          name: 'IX',
          title: 'Rule IX — Porta Externa · External Gate (retired)',
          klass: 'security',
          tier: 'invariant',
        },
      ],
    })
    const { container } = render(<Laws />)
    await waitFor(() => expect(screen.getByText('External Gate')).toBeTruthy())
    const rows = [...container.querySelectorAll('.law-row')].map((r) => [
      r.querySelector('.law-no').textContent.replace('›', ''),
      r.querySelector('.law-name > span').textContent,
      r.querySelector('.law-latin').textContent,
      r.querySelector('.law-status').textContent,
      r.querySelector('.law-enf').textContent,
    ])
    expect(rows).toEqual([
      ['I', 'Sealed Secrets', '', 'Active', 'Hook gate'],
      ['II', 'One Intent, One Act', '', 'Active', 'Instruction'],
      ['III', 'Verify Before Asserting', '', 'Active', 'Hook gate'],
      ['IX', 'External Gate', 'Porta Externa', 'Retired', 'None'],
    ])
  })

  it('narrows to one tier with the segmented tabs', async () => {
    const { container } = render(<Laws />)
    await waitFor(() => expect(screen.getByText('Sealed Secrets')).toBeTruthy())
    // All = 3 invariants + 7 doctrine rules. Ethos is not counted: it sits above the tabs.
    expect(screen.getByRole('button', { name: 'All 10' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Doctrines 7' }))
    expect(screen.queryByText('Sealed Secrets')).toBeNull()
    // Ethos stays: the tabs narrow the rules, never the character above them.
    expect(screen.getByText('Telos')).toBeTruthy()
    expect(screen.getByText('Automate Repetition')).toBeTruthy()
    // The tier strip lights the tier the table shows.
    expect(container.querySelector('.tier.on .tier-name').textContent).toBe('Doctrines')
  })
  // The strip's Dictates and Doctrines cells are buttons that drive the same tab: a click shows
  // that tier, a click on the lit cell returns to All. Ethos is not a tab, so its cell is not a
  // control; Your rules stays a link. Queried by rank, the start of each cell's name, so the
  // tabs' own `/^Dictates/` and `/^All/` names stay theirs alone.
  it('narrows to a tier from the tier strip, and back to All from the lit cell', async () => {
    const { container } = render(<Laws />)
    await waitFor(() => expect(screen.getByText('Sealed Secrets')).toBeTruthy())
    const dictates = screen.getByRole('button', { name: /^RANK 1/ })
    const doctrines = screen.getByRole('button', { name: /^RANK 4/ })
    expect(screen.queryByRole('button', { name: /^RANK 3/ })).toBeNull()
    expect(container.querySelector('a.tier .tier-name').textContent).toBe('Your rules')
    expect(dictates.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(dictates)
    expect(dictates.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Dictates 3' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(screen.queryByText('Automate Repetition')).toBeNull()
    expect(screen.getByText('Sealed Secrets')).toBeTruthy()
    fireEvent.click(doctrines)
    expect(doctrines.getAttribute('aria-pressed')).toBe('true')
    expect(dictates.getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByText('Sealed Secrets')).toBeNull()
    fireEvent.click(doctrines)
    expect(screen.getByRole('button', { name: 'All 10' }).getAttribute('aria-pressed')).toBe('true')
    expect(doctrines.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('Sealed Secrets')).toBeTruthy()
    expect(screen.getByText('Automate Repetition')).toBeTruthy()
  })
  // A gate in the Gate asks card takes you to its rule: the whole entry is the control, and
  // a tab or filter hiding the rule is lifted first, so the row is there to land on.
  it('jumps from a gate to its rule, lifting a tab that hides it', async () => {
    window.location.hash = '#/laws'
    render(<Laws setup={{ gates: { asks: { 'process-5': 4 }, total: 4, standing_down: [] } }} />)
    await waitFor(() => expect(screen.getByText('Sealed Secrets')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^Dictates/ }))
    expect(screen.queryByText('Automate Repetition')).toBeNull()
    const gate = document.querySelector('.gate-row')
    expect(gate.querySelector('.gate-name').textContent).toBe('Consent Before Push')
    fireEvent.click(gate)
    expect(window.location.hash).toBe('#/item/law/process.5')
    expect(screen.getByRole('button', { name: /^All/ }).getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('[data-addr="process.5"]')).toBeTruthy()
  })

  it('deep-links each of the three address shapes to its own row', async () => {
    // One `type=law` route serves all three tiers, so the addresses must not collide and each
    // must open the row it names — the failure mode is a link that renders and dead-ends.
    for (const addr of ['ont:telos', 'II', 'process.5']) {
      api.item.mockClear()
      const { unmount } = render(<Laws selected={addr} />)
      await waitFor(() => expect(api.item).toHaveBeenCalledWith('law', addr))
      await waitFor(() => expect(screen.getByText(/The canonical text/)).toBeTruthy())
      unmount()
    }
  })

  it('names the right source file under each tier', async () => {
    // The srcline is the reader's pointer back to the authored text, and the three tiers live
    // in three different files — a single hardcoded `laws/universal.md` would send anyone
    // editing a doctrine rule to the wrong one.
    for (const [addr, src] of [
      ['ont:telos', 'ontology/universal.md'],
      ['I', 'laws/universal.md'],
      ['craft.1', 'doctrines/craft.md'],
    ]) {
      const { container, unmount } = render(<Laws selected={addr} />)
      await waitFor(() => expect(container.querySelector('.law-srcline')).toBeTruthy())
      expect(container.querySelector('.law-srcline').textContent).toContain(src)
      unmount()
    }
  })

  it('prints each rule summary the server sends under its name', async () => {
    // The summary lives in src/ beside each rule and arrives on the item; the page holds no copy
    // of its own, so a fixture string the page could not have known is the proof.
    api.catalog.mockResolvedValue({
      section: 'laws',
      items: [
        { ...INV[0], summary: 'Fixture principle I' },
        INV[1],
        { ...DOC[0], summary: 'Fixture principle craft 1' },
      ],
    })
    const { container } = render(<Laws />)
    await waitFor(() => expect(screen.getByText('Fixture principle I')).toBeTruthy())
    expect(screen.getByText('Fixture principle craft 1')).toBeTruthy()
    // A rule the server sends no summary for prints none, rather than a blank line.
    expect(container.querySelector('[data-addr="II"] .law-princ')).toBeNull()
  })

  it('reads an older server that sends no tier at all', async () => {
    // A new console against an old daemon gets items with no `tier`. Treating that as the
    // invariant band keeps the page readable instead of blank: the shape it rendered before
    // the split is exactly a list of invariants.
    api.catalog.mockResolvedValue({
      section: 'laws',
      items: [{ name: 'I', title: 'Rule I — Sealed Secrets', desc: '', klass: 'security' }],
    })
    const { container } = render(<Laws />)
    await waitFor(() => expect(screen.getByText('Sealed Secrets')).toBeTruthy())
    expect([...container.querySelectorAll('.band-head .tier-h')].map((h) => h.textContent)).toEqual(
      ['Dictates'],
    )
    expect(screen.getByText(/predates the three-tier constitution/)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------------------------
// The doctrine toggles. They live on THIS page and not in Settings because this is where a reader
// is already looking at what each rule says — dropping `process 5` is a decision about the line of
// text directly beside the switch, and a control three screens away makes it a decision taken
// blind.
//
// ⚠ THE UNIT IS THE RULE, NOT THE PACK. The pack switches in the aside are shortcuts that flip
// every rule of a pack; the pack axis is still DERIVED at Apply time from which rules survive,
// so "keep all of Observance but drop Codes That Persist" stays expressible.

const INSTALL = { host: 'opencode', scope: 'global' }
// ⚠ WAIT FOR THE SELECTION TO SETTLE, NOT MERELY FOR THE ROWS TO EXIST — and this gate is the
// difference between a green suite and a green-ish one. `picked` starts as `[]` and is seeded
// from the deployed rule set in an effect (Laws.jsx), so there is a real rendered frame in which
// every pack and every switch reads OFF. Gating on existence admitted that frame: two tests in
// this file failed roughly ONE RUN IN THREE — `.pack-off` counting 3 instead of 1, and a
// deployed rule's switch reading `aria-checked="false"`. Both were the same race, and neither
// was a product defect. Settling is observable as "at least one pack is not off", which cannot
// be true until the seed lands.
const settled = (c) =>
  waitFor(() => expect(c.querySelector('.pack-wrap:not(.pack-off)')).toBeTruthy())

const sw = (c, name) => c.querySelector(`[aria-label="${name} rule"]`)
const applyBtn = () => screen.getByText(/^Apply/).closest('button')
const withInstall = (onAction = () => {}) => (
  <Laws overview={{ install: INSTALL }} onAction={onAction} />
)

describe('Constitution page — doctrine toggles', () => {
  it('renders a switch per RULE, reflecting what is deployed', async () => {
    const { container } = render(withInstall())
    await settled(container)
    // One live pack, one rule excluded from it, one pack off entirely — three states, and the
    // switch reads the RULE every time.
    expect(sw(container, 'Automate Repetition').getAttribute('aria-checked')).toBe('true')
    expect(sw(container, 'Documentation in Step').getAttribute('aria-checked')).toBe('false')
    expect(sw(container, 'Tool Discovery').getAttribute('aria-checked')).toBe('false')
    // The pack switch is DERIVED from its rules, so it can never contradict the rule switches
    // under it: a tri-state checkbox, `true` with every rule on, `mixed` with some, `false` with
    // none. Craft has one rule excluded, so it reads mixed (a switch cannot say "partly").
    const craft = container.querySelector('[aria-label="Craft pack"]')
    expect(craft.getAttribute('role')).toBe('checkbox')
    expect(craft.getAttribute('aria-checked')).toBe('mixed')
    expect(craft.classList.contains('mixed')).toBe(true)
    expect(
      container.querySelector('[aria-label="Process pack"]').getAttribute('aria-checked'),
    ).toBe('true')
    expect(container.querySelector('[aria-label="Ops pack"]').getAttribute('aria-checked')).toBe(
      'false',
    )
    expect(container.querySelector('.pack-state').textContent).toBe('2 of 3 active')
    // Nothing staged, so nothing to apply: no Apply at all, not a disabled one.
    expect(screen.queryByRole('button', { name: /^Apply/ })).toBeNull()
  })

  // ⚠ ONE FILLED BUTTON PER VIEW. Apply is the page's primary action, so it sits in the
  // "Unapplied changes" bar, which appears only once something is staged; it is then the only
  // filled button on the page: every other control is secondary (ghost, soft, danger-line) or
  // not a `.btn` at all. Its label counts the staged rules: craft.3 switched on makes 5 of the 7.
  it('shows Apply as the one primary action, in the unapplied-changes bar, only once something is staged', async () => {
    const { container } = render(withInstall())
    await settled(container)
    expect(screen.queryAllByRole('button', { name: /^Apply/ })).toHaveLength(0)
    fireEvent.click(sw(container, 'Documentation in Step'))
    const apply = screen.getAllByRole('button', { name: /^Apply/ })
    expect(apply).toHaveLength(1)
    expect(apply[0].textContent).toBe('Apply (5/7 rules)')
    expect(apply[0].closest('[role="region"]').getAttribute('aria-label')).toBe('Unapplied changes')
    const filled = container.querySelectorAll('.btn:not(.ghost):not(.soft):not(.danger-line)')
    expect([...filled]).toEqual([apply[0]])
  })

  // The pack bars were aria-hidden spans, telling a reader nothing. Each is now an image whose
  // name reads the pack and its count against the largest pack (3 rules, craft), the scale the
  // bars are drawn on.
  it('names each pack bar with its rules on', async () => {
    const { container } = render(withInstall())
    await settled(container)
    const bars = [...container.querySelectorAll('.pack-list [role="img"]')]
    expect(bars.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Craft rules on: 2 of 3',
      'Process rules on: 2 of 3',
      'Ops rules on: 0 of 3',
    ])
  })

  it('a pack switch stages all of its rules at once, still applied once', async () => {
    // The usual tri-state rule: a pack with every rule on turns all off (so the pack drops out
    // of --doctrines); a pack with some or none on turns every rule on (so no exclusion
    // survives inside it). A partial pack therefore goes ON first, never off. Nothing is sent
    // until Apply.
    const onAction = vi.fn()
    const { container } = render(withInstall(onAction))
    await settled(container)
    const craft = () => container.querySelector('[aria-label="Craft pack"]')
    fireEvent.click(craft()) // mixed -> all on
    expect(sw(container, 'Documentation in Step').getAttribute('aria-checked')).toBe('true')
    expect(sw(container, 'Automate Repetition').getAttribute('aria-checked')).toBe('true')
    expect(craft().getAttribute('aria-checked')).toBe('true')
    fireEvent.click(container.querySelector('[aria-label="Process pack"]')) // all on -> all off
    expect(sw(container, 'Consent Before Push').getAttribute('aria-checked')).toBe('false')
    fireEvent.click(container.querySelector('[aria-label="Ops pack"]')) // none -> all on
    expect(sw(container, 'Tool Discovery').getAttribute('aria-checked')).toBe('true')
    expect(onAction).not.toHaveBeenCalled()
    fireEvent.click(applyBtn())
    await answered()
    expect(onAction.mock.calls[0][1].doctrines).toEqual(['craft', 'ops'])
    expect(onAction.mock.calls[0][1].excludeRules).toEqual([])
    vi.restoreAllMocks()
  })

  it('stages every toggle and rebuilds ONCE on Apply', async () => {
    // ⚠ THE WHOLE POINT. Acting per click would re-emit the install once per switch — each
    // rebuild describing a state nobody asked for, each writing a different marker pair.
    const onAction = vi.fn()
    const { container } = render(withInstall(onAction))
    await settled(container)
    fireEvent.click(sw(container, 'Documentation in Step')) // off -> on
    fireEvent.click(sw(container, 'English Configuration')) // on  -> off
    expect(onAction).not.toHaveBeenCalled() // still nothing — this is the claim
    fireEvent.click(applyBtn())
    await answered()
    expect(onAction).toHaveBeenCalledTimes(1)
    const [action, body] = onAction.mock.calls[0]
    expect(action).toBe('install')
    expect(body.doctrines).toEqual(['craft', 'process'])
    expect(body.excludeRules).toEqual(['craft.2'])
    expect(body.host).toBe('opencode')
    vi.restoreAllMocks()
  })

  it('changes a switch without opening its rule', async () => {
    const { container } = render(withInstall())
    await settled(container)
    const disclosure = container.querySelector('.law-disclosure')
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(sw(container, 'Automate Repetition'))
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps a pack while excluding one of its rules', async () => {
    // ⚠ THE CASE THE PACK-LEVEL CONTROL COULD NOT EXPRESS: everything in Process except one
    // rule. `doctrines` must still carry `process` — dropping the pack would take the other
    // six rules with it.
    const onAction = vi.fn()
    const { container } = render(withInstall(onAction))
    await waitFor(() => expect(sw(container, 'Codes That Persist')).toBeTruthy())
    fireEvent.click(sw(container, 'Codes That Persist'))
    fireEvent.click(applyBtn())
    await answered()
    const body = onAction.mock.calls[0][1]
    expect(body.doctrines).toContain('process')
    expect(body.excludeRules).toEqual(['craft.3', 'process.7'])
    vi.restoreAllMocks()
  })

  it('a pack whose every rule is off drops out of the selection entirely', async () => {
    // The two axes are not independent: an empty pack must leave `--doctrines`, or AGENT.md
    // renders a pack header with nothing under it. And its rules must NOT then be listed as
    // exclusions — the pack's absence already says it, and naming both is what the CLI rejects.
    const onAction = vi.fn()
    const { container } = render(withInstall(onAction))
    await settled(container)
    fireEvent.click(sw(container, 'Automate Repetition'))
    fireEvent.click(sw(container, 'English Configuration')) // craft.3 is already off
    fireEvent.click(applyBtn())
    await answered()
    const body = onAction.mock.calls[0][1]
    expect(body.doctrines).toEqual(['process'])
    expect(body.excludeRules).toEqual([])
    vi.restoreAllMocks()
  })

  it('turning every rule off is a real selection, not a no-op', async () => {
    // The server reads `[]` as a deliberate `--doctrines none` and anything falsier as
    // "unspecified", which resolves to ALL packs — so an empty list must arrive as an empty list.
    const onAction = vi.fn()
    const { container } = render(withInstall(onAction))
    await settled(container)
    for (const name of [
      'Automate Repetition',
      'English Configuration',
      'Consent Before Push',
      'Codes That Persist',
    ]) {
      fireEvent.click(sw(container, name))
    }
    fireEvent.click(applyBtn())
    await answered()
    expect(onAction.mock.calls[0][1].doctrines).toEqual([])
    expect(onAction.mock.calls[0][1].excludeRules).toEqual([])
    vi.restoreAllMocks()
  })

  it('a staged pack reads as staged, not as deployed', async () => {
    // The header must not claim `active` for something that has not been applied — that is the
    // one lie a staged control can tell.
    const { container } = render(withInstall())
    await waitFor(() => expect(sw(container, 'Tool Discovery')).toBeTruthy())
    expect(screen.getByText(/not built in/)).toBeTruthy()
    fireEvent.click(sw(container, 'Tool Discovery'))
    expect(screen.getByText(/staged on/)).toBeTruthy()
    expect(screen.queryByText(/not built in/)).toBeNull()
  })

  it('warns before dropping the RULE that carries the consent gate', async () => {
    // Supported, so it is NAMED rather than refused — and named at rule granularity now, since
    // dropping `process 7` beside it costs nothing at the tool boundary.
    const onAction = vi.fn()
    const confirm = askConfirm
    confirm.mockClear()
    const { container } = render(withInstall(onAction))
    await waitFor(() => expect(sw(container, 'Codes That Persist')).toBeTruthy())
    fireEvent.click(sw(container, 'Codes That Persist'))
    fireEvent.click(applyBtn())
    await answered()
    expect(confirm.mock.calls[0][0]).not.toMatch(/consent/) // a sibling rule costs no gate
    fireEvent.click(sw(container, 'Consent Before Push'))
    fireEvent.click(applyBtn())
    await answered()
    expect(confirm.mock.calls[1][0]).toMatch(/process 5/)
    expect(confirm.mock.calls[1][0]).toMatch(/consent/)
    expect(onAction).toHaveBeenCalledTimes(2)
    vi.restoreAllMocks()
  })

  it('shows no switches at all when there is no install to rebuild', async () => {
    // A source render still READS; it just cannot be changed from here, so the command fallback
    // takes over — spelled `geneseed-build`, because the CLI's `build` verb forwards `--theme`
    // and nothing else and the shorter spelling errors.
    const { container } = render(<Laws />)
    await waitFor(() => expect(screen.getByText('Automate Repetition')).toBeTruthy())
    expect(sw(container, 'Automate Repetition')).toBeNull()
    expect(screen.queryByText(/^Apply/)).toBeNull()
    const cmd = screen.getByText(/geneseed-build --doctrines/)
    expect(cmd.textContent).toContain('craft,process,ops')
    expect(screen.queryByText(/\$ geneseed build --doctrines/)).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// Law IV's deletion gate switch (`--no-deletion-gate`, user decision 2026-10-17). One switch on
// row IV, read off `overview.install.deletionGate`: the badge says what the BOUNDARY does
// ("Hook gate" armed, "Gate off" disarmed — the rule's text binds either way), and a click asks,
// then rebuilds once with the opposite switch and every other field of the install unchanged.

const LAW4 = {
  name: 'IV',
  title: 'Rule IV — Deletio Deliberata · Deletion Is Deliberate',
  desc: '',
  klass: 'security',
  tier: 'invariant',
}
const gatePage = (install, onAction = () => {}) => (
  <Laws overview={install ? { install } : {}} onAction={onAction} />
)
const law4Row = (c) => c.querySelector('[data-addr="IV"]')

describe('Constitution page — the deletion gate switch', () => {
  beforeEach(() => {
    api.catalog.mockResolvedValue({ section: 'laws', items: [...INV, LAW4, ...DOC] })
  })

  it('an armed install reads Hook gate with the switch on', async () => {
    const { container } = render(gatePage({ ...INSTALL, deletionGate: true }))
    await waitFor(() => expect(law4Row(container)).toBeTruthy())
    expect(law4Row(container).querySelector('.law-enf').textContent).toBe('Hook gate')
    const gate = container.querySelector('[aria-label="Deletion gate"]')
    expect(gate.getAttribute('aria-checked')).toBe('true')
    // One switch per gate: the Deletion gate's label names row IV's alone.
    expect(
      container.querySelectorAll('.law-row.has-toggle [aria-label="Deletion gate"]').length,
    ).toBe(1)
  })

  it('a disarmed install reads Gate off with the switch off', async () => {
    const { container } = render(gatePage({ ...INSTALL, deletionGate: false }))
    await waitFor(() => expect(law4Row(container)).toBeTruthy())
    const enf = law4Row(container).querySelector('.law-enf')
    expect(enf.textContent).toBe('Gate off')
    expect(enf.classList.contains('hook')).toBe(false)
    expect(
      container.querySelector('[aria-label="Deletion gate"]').getAttribute('aria-checked'),
    ).toBe('false')
  })

  it('an older daemon that sends no switch reads as armed', async () => {
    const { container } = render(gatePage({ ...INSTALL }))
    await waitFor(() => expect(law4Row(container)).toBeTruthy())
    expect(law4Row(container).querySelector('.law-enf').textContent).toBe('Hook gate')
  })

  it('flipping the switch asks, then rebuilds once with the opposite value', async () => {
    const onAction = vi.fn()
    const { container } = render(gatePage({ ...INSTALL, deletionGate: true }, onAction))
    await waitFor(() =>
      expect(container.querySelector('[aria-label="Deletion gate"]')).toBeTruthy(),
    )
    fireEvent.click(container.querySelector('[aria-label="Deletion gate"]'))
    await answered()
    expect(askConfirm).toHaveBeenCalledTimes(1)
    expect(askConfirm.mock.calls[0][0]).toMatch(/deletion gate off/)
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction.mock.calls[0]).toEqual(['install', { ...INSTALL, deletionGate: false }])
  })

  it('a no answer rebuilds nothing', async () => {
    askConfirm.mockResolvedValueOnce(false)
    const onAction = vi.fn()
    const { container } = render(gatePage({ ...INSTALL, deletionGate: false }, onAction))
    await waitFor(() =>
      expect(container.querySelector('[aria-label="Deletion gate"]')).toBeTruthy(),
    )
    fireEvent.click(container.querySelector('[aria-label="Deletion gate"]'))
    await answered()
    expect(onAction).not.toHaveBeenCalled()
  })

  it('shows no switch without an install to rebuild', async () => {
    const { container } = render(gatePage(null, undefined))
    await waitFor(() => expect(law4Row(container)).toBeTruthy())
    expect(container.querySelector('[aria-label="Deletion gate"]')).toBeNull()
    expect(law4Row(container).querySelector('.law-enf').textContent).toBe('Hook gate')
  })

  it('names the staged doctrine changes the gate rebuild leaves staged, only when there are some', async () => {
    // The gate rebuild spreads `install`, so it carries the DEPLOYED doctrine rules, not the
    // staged ones: a reader with switches flipped must not think this click applies them.
    const STAYS = 'Your staged doctrine changes are not part of this rebuild; they stay staged.'
    const { container } = render(gatePage({ ...INSTALL, deletionGate: true }))
    await settled(container)
    const gate = () => container.querySelector('[aria-label="Deletion gate"]')
    fireEvent.click(gate())
    await answered()
    expect(askConfirm.mock.calls[0][0]).not.toContain(STAYS)
    fireEvent.click(sw(container, 'Documentation in Step'))
    fireEvent.click(gate())
    await answered()
    expect(askConfirm.mock.calls[1][0]).toContain(STAYS)
  })
})

// ---------------------------------------------------------------------------------------------
// Laws I and III get the same switch (`--no-secrets-gate`, `--no-done-gate`, user decision
// 2026-10-18), read off `overview.install.secretsGate` / `doneGate`. Every other active law's
// toggle column says "no gate": its text is all there is, so there is nothing to switch off.

const lawRow = (c, addr) => c.querySelector(`[data-addr="${addr}"]`)

describe('Constitution page — the secrets and done gate switches', () => {
  beforeEach(() => {
    api.catalog.mockResolvedValue({ section: 'laws', items: [...INV, LAW4, ...DOC] })
  })

  it('an armed install shows a switch on I, III and IV, and "no gate" on II', async () => {
    const { container } = render(gatePage({ ...INSTALL }))
    await waitFor(() => expect(lawRow(container, 'IV')).toBeTruthy())
    for (const [addr, label] of [
      ['I', 'Secrets gate'],
      ['III', 'Done gate'],
      ['IV', 'Deletion gate'],
    ]) {
      const s = lawRow(container, addr).querySelector('[role="switch"]')
      expect(s.getAttribute('aria-label')).toBe(label)
      expect(s.getAttribute('aria-checked')).toBe('true')
      expect(lawRow(container, addr).querySelector('.law-enf').textContent).toBe('Hook gate')
    }
    expect(lawRow(container, 'II').querySelector('[role="switch"]')).toBeNull()
    expect(lawRow(container, 'II').querySelector('.no-gate').textContent).toBe('no gate')
    expect(lawRow(container, 'II').querySelector('.law-enf').textContent).toBe('Instruction')
  })

  it('a law whose gate is off reads Gate off; its neighbours stay armed', async () => {
    const { container } = render(gatePage({ ...INSTALL, secretsGate: false }))
    await waitFor(() => expect(lawRow(container, 'I')).toBeTruthy())
    expect(lawRow(container, 'I').querySelector('.law-enf').textContent).toBe('Gate off')
    expect(
      container.querySelector('[aria-label="Secrets gate"]').getAttribute('aria-checked'),
    ).toBe('false')
    expect(lawRow(container, 'III').querySelector('.law-enf').textContent).toBe('Hook gate')
    expect(lawRow(container, 'IV').querySelector('.law-enf').textContent).toBe('Hook gate')
  })

  it('flipping the done gate asks, then rebuilds once with that one key flipped', async () => {
    const onAction = vi.fn()
    const { container } = render(gatePage({ ...INSTALL, doneGate: true }, onAction))
    await waitFor(() => expect(container.querySelector('[aria-label="Done gate"]')).toBeTruthy())
    fireEvent.click(container.querySelector('[aria-label="Done gate"]'))
    await answered()
    expect(askConfirm).toHaveBeenCalledTimes(1)
    expect(askConfirm.mock.calls[0][0]).toMatch(/done gate off/)
    expect(askConfirm.mock.calls[0][0]).toMatch(/text still binds/)
    expect(onAction.mock.calls).toEqual([['install', { ...INSTALL, doneGate: false }]])
  })

  it('re-arming the secrets gate asks to re-arm', async () => {
    const onAction = vi.fn()
    const { container } = render(gatePage({ ...INSTALL, secretsGate: false }, onAction))
    await waitFor(() => expect(container.querySelector('[aria-label="Secrets gate"]')).toBeTruthy())
    fireEvent.click(container.querySelector('[aria-label="Secrets gate"]'))
    await answered()
    expect(askConfirm.mock.calls[0][0]).toMatch(/Re-arm the secrets gate/)
    expect(onAction.mock.calls).toEqual([['install', { ...INSTALL, secretsGate: true }]])
  })

  it('without an install to rebuild there is no toggle column at all', async () => {
    const { container } = render(gatePage(null, undefined))
    await waitFor(() => expect(lawRow(container, 'I')).toBeTruthy())
    expect(container.querySelector('[role="switch"][aria-label$="gate"]')).toBeNull()
    expect(container.querySelector('.no-gate')).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// One rule row, opened: its body, its fetch lifecycle, and what a screen reader hears.

describe('Constitution page — an opened rule', () => {
  it('renders the body as Markdown: bold and a numbered list, no stray asterisk', async () => {
    // The old inline formatter knew `code` and *em* only, so Telos's **bold** list rendered
    // as a stray `*` and inverted emphasis, all in one paragraph.
    api.item.mockResolvedValue({ body: '**First** rule.\n\n1. one\n2. two\n' })
    const { container } = render(<Laws selected="ont:telos" />)
    await waitFor(() => expect(container.querySelector('.law-expand strong')).toBeTruthy())
    const body = container.querySelector('.law-expand')
    expect(body.querySelector('strong').textContent).toBe('First')
    expect(body.querySelectorAll('li').length).toBe(2)
    expect(body.textContent).not.toContain('*')
  })

  it('shows a failed fetch with a Retry that fetches again', async () => {
    // A rejected fetch used to show "Loading…" for ever: the error was never read.
    api.item.mockRejectedValueOnce(new Error('daemon gone'))
    render(<Laws selected="II" />)
    // The alert is ErrorState's: the message and its Retry, together.
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('daemon gone'))
    expect(screen.queryByText(/The canonical text/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByText(/The canonical text/)).toBeTruthy())
    expect(api.item).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a closed and reopened rule is served from the cache, not fetched again', async () => {
    // A row click only moves the hash, so the open state is driven by `selected` here.
    const { rerender } = render(<Laws selected="II" />)
    await waitFor(() => expect(screen.getByText(/The canonical text/)).toBeTruthy())
    rerender(<Laws />)
    await waitFor(() => expect(screen.queryByText(/The canonical text/)).toBeNull())
    rerender(<Laws selected="II" />)
    expect(screen.getByText(/The canonical text/)).toBeTruthy()
    expect(api.item.mock.calls.filter(([, a]) => a === 'II').length).toBe(1)
  })

  it('a new data revision fetches an open rule again', async () => {
    // A rebuild or a theme change bumps `dataRev`: the cached body is the old install's text.
    const { rerender } = render(<Laws selected="II" dataRev={1} />)
    await waitFor(() => expect(screen.getByText(/The canonical text/)).toBeTruthy())
    rerender(<Laws selected="II" dataRev={2} />)
    await waitFor(() => expect(api.item.mock.calls.filter(([, a]) => a === 'II').length).toBe(2))
  })

  it('renders a hostile body inert: no handler, no script, no javascript: link', async () => {
    // A rule body is Markdown from disk, so it goes through the shared sanitizer.
    api.item.mockResolvedValue({
      body: '<img src=x onerror="alert(1)"><script>x</script>\n\n[a](javascript:alert(1))',
    })
    const { container } = render(<Laws selected="II" />)
    await waitFor(() => expect(container.querySelector('.law-expand .markdown')).toBeTruthy())
    const body = container.querySelector('.law-expand')
    expect(body.querySelector('[onerror]')).toBeNull()
    expect(body.querySelector('script')).toBeNull()
    const hrefs = [...body.querySelectorAll('[href]')].map((a) => a.getAttribute('href'))
    expect(hrefs.filter((h) => /^\s*javascript:/i.test(h))).toEqual([])
  })

  it('a row button names the rule, not every column run together', async () => {
    // The accessible name was "› II One Intent, One Act Active Instruction"; it is now the
    // number, the name, the status and the enforcement, and it points at the body it opens.
    const { container } = render(<Laws selected="II" />)
    await waitFor(() => expect(container.querySelector('.law-expand')).toBeTruthy())
    const btn = screen.getByRole('button', { name: 'II One Intent, One Act, Active, Instruction' })
    expect(btn.getAttribute('type')).toBe('button')
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    const id = btn.getAttribute('aria-controls')
    expect(id).toBeTruthy()
    expect(document.getElementById(id)).toBe(container.querySelector('.law-expand'))
    // An ethos section has no number: its name opens the label.
    expect(screen.getByRole('button', { name: 'Telos, Always, Instruction' })).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------------------------
// The Gate asks card on an install whose deletion gate is OFF: Rule IV's past asks stay in the
// ledger, but the gate asks nothing now, so its entry must not lead the card as if it did.

describe('Constitution page — the Gate asks card', () => {
  beforeEach(() => {
    api.catalog.mockResolvedValue({ section: 'laws', items: [...INV, LAW4, ...DOC] })
  })

  it('a disarmed gate sorts last, reads off, and its bar loses the warning', async () => {
    render(
      <Laws
        overview={{ install: { ...INSTALL, deletionGate: false } }}
        setup={{ gates: { asks: { 'law-4': 135, 'process-1': 6 }, total: 141, standing_down: [] } }}
      />,
    )
    await waitFor(() => expect(document.querySelectorAll('.gate-row').length).toBe(2))
    const [first, second] = document.querySelectorAll('.gate-row')
    // The bar is the row button's sibling in the same entry (a button may not hold a div).
    const bar = (row) => row.closest('li').querySelector('[role="img"]')
    expect(first.textContent).toContain('process.1')
    expect(first.querySelector('.off')).toBeNull()
    expect(bar(first).querySelector('.tone-warn')).toBeTruthy()
    expect(second.querySelector('.gate-name').textContent).toBe('Deletion Is Deliberate')
    expect(second.querySelector('.gate-name').classList.contains('dim')).toBe(true)
    expect(second.querySelector('.off').textContent).toBe('off')
    expect(bar(second).querySelector('.tone-warn')).toBeNull()
    expect(bar(second).querySelector('.tone-accent')).toBeTruthy()
    // Each bar is named by its gate, so a reader can tell them apart; the count is against the
    // busiest gate (135 asks). process.1 has no row in this fixture, so its address names it.
    expect(bar(first).getAttribute('aria-label')).toBe('process.1 asks: 6 of 135')
    expect(bar(second).getAttribute('aria-label')).toBe('Deletion Is Deliberate asks: 135 of 135')
    expect(first.querySelector('[role="img"]')).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// The tier nouns come from the install's theme (`nouns` on /api/catalog/laws); an older daemon
// sends none, and the page then keeps the names it always printed.

describe('Constitution page — themed tier nouns', () => {
  it('names the tiers in the theme voice when the payload carries nouns', async () => {
    api.catalog.mockResolvedValue({
      ...PAYLOAD,
      nouns: { ontology: 'Credo', law: 'Dictate', laws: 'Dictates', doctrines: 'Doctrinae' },
    })
    const { container } = render(<Laws />)
    await waitFor(() => expect(container.querySelector('.band-head')).toBeTruthy())
    expect([...container.querySelectorAll('.tier-name')].map((n) => n.textContent)).toEqual([
      'Dictates',
      'Your rules',
      'Credo',
      'Doctrinae',
    ])
    expect(container.querySelector('.band-head .tier-h').textContent).toBe('Credo')
    expect(screen.getByRole('button', { name: /^Doctrinae/ })).toBeTruthy()
  })

  it('uses the neutral rule noun in the rank line', async () => {
    api.catalog.mockResolvedValue({
      ...PAYLOAD,
      nouns: { ontology: 'Ethos', law: 'Rule', laws: 'Rules', doctrines: 'Doctrines' },
    })
    const { container } = render(<Laws />)
    await waitFor(() => expect(container.querySelector('.band-head')).toBeTruthy())
    expect([...container.querySelectorAll('.band-head .tier-h')].map((h) => h.textContent)).toEqual(
      ['Ethos', 'Rules', 'Craft', 'Process', 'Ops'],
    )
    expect(container.querySelectorAll('.tier-rule')[1].textContent).toBe(
      'May tighten a Rule, never repeal one.',
    )
    expect(screen.getByRole('button', { name: /^Rules/ })).toBeTruthy()
  })

  it('falls back to Ethos, Dictates and Doctrines without nouns', async () => {
    const { container } = render(<Laws />)
    await waitFor(() => expect(container.querySelector('.band-head')).toBeTruthy())
    expect([...container.querySelectorAll('.tier-name')].map((n) => n.textContent)).toEqual([
      'Dictates',
      'Your rules',
      'Ethos',
      'Doctrines',
    ])
    expect(screen.getByRole('button', { name: /^Dictates/ })).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------------------------
// The V6b layout (the "precedence ladder" mockup): the two narrowing toggles beside the tier
// tabs, folding packs, the asks count on a gated row, the rung state pills, ranks 5 and 6, and
// the bar that holds every staged change with its Review / Revert / Apply.

describe('Constitution page — the ladder layout', () => {
  // Gated: a hook enforces the rule now. In the fixture that is laws I and III and process.5;
  // law II is text-only, no craft rule has a hook, and ops.2's root-scan hook goes with its pack,
  // which this install does not build in.
  it('narrows to the hook-gated rules, and back with a second click', async () => {
    const { container } = render(withInstall())
    await settled(container)
    const gated = screen.getByRole('button', { name: 'Gated 3' })
    fireEvent.click(gated)
    expect(gated.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Sealed Secrets')).toBeTruthy()
    expect(screen.getByText('Consent Before Push')).toBeTruthy()
    expect(screen.queryByText('One Intent, One Act')).toBeNull()
    expect(screen.queryByText('Automate Repetition')).toBeNull()
    expect(screen.queryByText('Commands Must Return')).toBeNull()
    fireEvent.click(gated)
    expect(gated.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('Automate Repetition')).toBeTruthy()
  })

  // Changed: a doctrine rule whose staged switch differs from the install. Nothing is staged at
  // first; switching craft.3 on stages exactly one.
  it('narrows to the staged changes, which the bar lists and reviews', async () => {
    const { container } = render(withInstall())
    await settled(container)
    expect(screen.getByRole('button', { name: 'Changed 0' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Unapplied changes' })).toBeNull()
    fireEvent.click(sw(container, 'Documentation in Step'))
    // Hide the staged row three ways; Review must lift all three.
    fireEvent.click(screen.getByRole('button', { name: 'Craft' }))
    fireEvent.click(screen.getByRole('button', { name: /^Dictates/ }))
    fireEvent.change(screen.getByLabelText('Filter rules'), { target: { value: 'Sealed' } })
    expect(container.querySelector('[data-addr="craft.3"]')).toBeNull()
    const bar = screen.getByRole('region', { name: 'Unapplied changes' })
    expect(bar.querySelector('.law-bar-n').textContent).toBe('1 unapplied change')
    expect([...bar.querySelectorAll('.badge')].map((b) => b.textContent)).toEqual([
      '+ craft 3 Documentation in Step',
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Review changes' }))
    expect(screen.getByRole('button', { name: 'Changed 1' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(screen.queryByText('Sealed Secrets')).toBeNull()
    expect(screen.queryByText('Automate Repetition')).toBeNull()
    expect(container.querySelector('[data-addr="craft.3"]')).toBeTruthy()
    expect(screen.getByLabelText('Filter rules').value).toBe('')
  })

  it('Revert in the bar drops the staged selection and the bar with it', async () => {
    const { container } = render(withInstall())
    await settled(container)
    fireEvent.click(sw(container, 'English Configuration'))
    expect(sw(container, 'English Configuration').getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    expect(sw(container, 'English Configuration').getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByRole('region', { name: 'Unapplied changes' })).toBeNull()
  })

  it('folds a pack under its heading, and a gate jump unfolds it', async () => {
    window.location.hash = '#/laws'
    const { container } = render(
      <Laws setup={{ gates: { asks: { 'process-5': 4 }, total: 4, standing_down: [] } }} />,
    )
    await waitFor(() => expect(container.querySelector('[data-addr="process.5"]')).toBeTruthy())
    const fold = screen.getByRole('button', { name: 'Process' })
    expect(fold.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(fold)
    expect(fold.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[data-addr="process.5"]')).toBeNull()
    expect(screen.getByText('Automate Repetition')).toBeTruthy() // the other packs stay open
    fireEvent.click(document.querySelector('.gate-row'))
    expect(window.location.hash).toBe('#/item/law/process.5')
  })

  // The jump changes the hash; the page reads it back as `selected`. Rendered with the address
  // selected, a folded pack holding it cannot stay folded, or the jump finds no row.
  it('never folds the pack that holds the open rule', async () => {
    window.location.hash = '#/laws'
    const { container, rerender } = render(<Laws />)
    await waitFor(() => expect(screen.getByText('Consent Before Push')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Process' }))
    expect(container.querySelector('[data-addr="process.5"]')).toBeNull()
    rerender(<Laws selected="process.5" />)
    expect(container.querySelector('[data-addr="process.5"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Process' }).getAttribute('aria-expanded')).toBe(
      'true',
    )
  })

  it('prints a gated rule’s ask count from the gate ledger', async () => {
    const { container } = render(
      <Laws
        setup={{ gates: { asks: { 'process-5': 4, 'law-1': 1 }, total: 5, standing_down: [] } }}
      />,
    )
    await waitFor(() => expect(container.querySelector('[data-addr="process.5"]')).toBeTruthy())
    expect(container.querySelector('[data-addr="process.5"] .law-asks').textContent).toBe('4 asks')
    expect(container.querySelector('[data-addr="I"] .law-asks').textContent).toBe('1 ask')
    expect(container.querySelector('[data-addr="II"] .law-asks')).toBeNull()
  })

  // Each rung's pill: Dictates and Ethos always bind; Your rules are yours; Doctrines count the
  // rules the install excludes (craft.3, ops.1, ops.2 in the fixture). A switched-off gate is
  // the one way the Dictates rung stops reading "always".
  it('marks each rung with its state, and lists ranks 5 and 6 below', async () => {
    const { container } = render(withInstall())
    await settled(container)
    const pills = [...container.querySelectorAll('.tier-pill')].map((p) => p.textContent)
    expect(pills).toEqual(['always', 'yours', 'always', '3 excluded'])
    expect([...container.querySelectorAll('.ladder-low')].map((r) => r.textContent)).toEqual([
      'RANK 5 Mode — binds how work runs',
      'RANK 6 Profile, posture, theme — inform only; never bind',
    ])
  })

  it('a Dictates rung whose gate is off says so', async () => {
    const { container } = render(
      <Laws overview={{ install: { ...INSTALL, secretsGate: false } }} onAction={() => {}} />,
    )
    await settled(container)
    expect(container.querySelector('.tier-pill').textContent).toBe('1 gate off')
  })

  it('names the install in the eyebrow', async () => {
    const { container } = render(
      <Laws
        overview={{ theme: 'imperial', install: { ...INSTALL, footprint: 'lean' } }}
        onAction={() => {}}
      />,
    )
    await settled(container)
    expect(container.querySelector('.page-head .eyebrow').textContent).toBe(
      'imperial · lean footprint · opencode · global',
    )
  })
})
