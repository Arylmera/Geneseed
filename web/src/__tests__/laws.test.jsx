import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The Constitution page had NO component test before this file — its only gate was doctor's
// LAW_META parity, which reads a literal and knows nothing about what renders. So the claims
// here are the ones a server-side gate structurally cannot make: that all three tiers reach the
// DOM, that a pack which is not built in is visible rather than absent, and that each of the
// three address shapes deep-links to the right row.

vi.mock('../api/index.js', () => ({
  api: { catalog: vi.fn(), item: vi.fn() },
}))

import Laws from '../pages/Laws.jsx'
import { api } from '../api/index.js'

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
  api.catalog.mockResolvedValue(PAYLOAD)
  api.item.mockResolvedValue({ body: 'The canonical text of this entry.' })
})

describe('Constitution page', () => {
  it('renders all three tier bands, in constitutional order', async () => {
    // Queried by HEADING and not by text: the three nouns also appear in the page's subtitle,
    // so `getByText('Ontology')` matches two nodes and says so. The order is the claim anyway —
    // this page exists to be read top to bottom.
    const { container } = render(<Laws />)
    await waitFor(() => expect(container.querySelector('.tier-h')).toBeTruthy())
    expect([...container.querySelectorAll('.tier-h')].map((h) => h.textContent)).toEqual([
      'Ontology',
      'Invariants',
      'Doctrines',
    ])
    // ...and the entries themselves, one per tier, with the address prefix stripped off the
    // display name — the row shows the rule's NAME, not `Doctrine craft 1 — Automate Repetition`.
    expect(screen.getByText('Telos')).toBeTruthy()
    expect(screen.getByText('Sealed Secrets')).toBeTruthy()
    expect(screen.getByText('Automate Repetition')).toBeTruthy()
  })

  it('shows a pack that is not built in, greyed, with the command to enable it', async () => {
    // ⚠ THE CLAIM THIS PAGE EXISTS FOR. An inactive pack that were simply omitted would make
    // "off" indistinguishable from "never shipped" — and the enable command has to name the
    // WHOLE selection, because `--doctrines` replaces the set rather than adding to it.
    //
    // This is the no-install case: with one to rebuild, the switches take over and the command
    // is not shown at all (see the toggle suite below).
    const { container } = render(<Laws />)
    await waitFor(() => expect(container.querySelector('.pack-wrap')).toBeTruthy())
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

  it('renders only the classes that have an invariant', async () => {
    // Two of the six classes lost their last member in the split. A chip reading `Context 0` is
    // a filter whose only possible result is the empty state.
    const { container } = render(<Laws />)
    await waitFor(() => expect(screen.getByText('Sealed Secrets')).toBeTruthy())
    const chips = [...container.querySelectorAll('.law-cats .law-cat')].map(
      (b) => b.querySelector('span:not(.cdot):not(.cn)')?.textContent,
    )
    expect(chips).toContain('Security')
    expect(chips).toContain('Process')
    expect(chips).toContain('Verification')
    expect(chips).not.toContain('Context')
    expect(chips).not.toContain('Communication')
    // The readout counts what it shows, and calls them invariants rather than "rules" — the
    // page has 23 more rules than these below.
    expect(container.querySelector('.law-toolbar .law-readout').textContent).toContain(
      '3 invariants',
    )
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

  it('reads an older server that sends no tier at all', async () => {
    // A new console against an old daemon gets items with no `tier`. Treating that as the
    // invariant band keeps the page readable instead of blank — the shape it rendered before
    // the split is exactly a list of invariants.
    api.catalog.mockResolvedValue({
      section: 'laws',
      items: [{ name: 'I', title: 'Rule I — Sealed Secrets', desc: '', klass: 'security' }],
    })
    const { container } = render(<Laws />)
    await waitFor(() => expect(screen.getByText('Sealed Secrets')).toBeTruthy())
    expect(container.querySelector('.law-toolbar .law-readout').textContent).toContain(
      '1 invariants',
    )
    expect(screen.getByText(/No ontology sections/)).toBeTruthy()
    expect(screen.getByText(/No doctrine packs/)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------------------------
// The doctrine toggles. They live on THIS page and not in Settings because this is where a reader
// is already looking at what each rule says — dropping `process 5` is a decision about the line of
// text directly beside the switch, and a control three screens away makes it a decision taken
// blind.
//
// ⚠ THE UNIT IS THE RULE, NOT THE PACK. There is no pack switch anywhere on this page: the pack
// axis is DERIVED at Apply time from which rules survive, so "keep all of Observance but drop
// Codes That Persist" is expressible — which the pack-level control it replaced could not say.

const INSTALL = { host: 'opencode', scope: 'global' }
const sw = (c, name) => c.querySelector(`[aria-label="${name} rule"]`)
const applyBtn = () => screen.getByText(/^Apply/).closest('button')
const withInstall = (onAction = () => {}) => (
  <Laws overview={{ install: INSTALL }} onAction={onAction} />
)

describe('Constitution page — doctrine toggles', () => {
  it('renders a switch per RULE, reflecting what is deployed', async () => {
    const { container } = render(withInstall())
    await waitFor(() => expect(sw(container, 'Automate Repetition')).toBeTruthy())
    // One live pack, one rule excluded from it, one pack off entirely — three states, and the
    // switch reads the RULE every time.
    expect(sw(container, 'Automate Repetition').getAttribute('aria-checked')).toBe('true')
    expect(sw(container, 'Documentation in Step').getAttribute('aria-checked')).toBe('false')
    expect(sw(container, 'Tool Discovery').getAttribute('aria-checked')).toBe('false')
    // ...and no pack-level switch survives, or the two controls could contradict each other.
    expect(container.querySelector('[aria-label="Craft pack"]')).toBeNull()
    expect(container.querySelector('.pack-state').textContent).toBe('2 of 3 active')
    expect(applyBtn().disabled).toBe(true)
  })

  it('stages every toggle and rebuilds ONCE on Apply', async () => {
    // ⚠ THE WHOLE POINT. Acting per click would re-emit the install once per switch — each
    // rebuild describing a state nobody asked for, each writing a different marker pair.
    const onAction = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { container } = render(withInstall(onAction))
    await waitFor(() => expect(sw(container, 'Automate Repetition')).toBeTruthy())
    fireEvent.click(sw(container, 'Documentation in Step')) // off -> on
    fireEvent.click(sw(container, 'English Configuration')) // on  -> off
    expect(onAction).not.toHaveBeenCalled() // still nothing — this is the claim
    fireEvent.click(applyBtn())
    expect(onAction).toHaveBeenCalledTimes(1)
    const [action, body] = onAction.mock.calls[0]
    expect(action).toBe('install')
    expect(body.doctrines).toEqual(['craft', 'process'])
    expect(body.excludeRules).toEqual(['craft.2'])
    expect(body.host).toBe('opencode')
    vi.restoreAllMocks()
  })

  it('keeps a pack while excluding one of its rules', async () => {
    // ⚠ THE CASE THE PACK-LEVEL CONTROL COULD NOT EXPRESS: everything in Process except one
    // rule. `doctrines` must still carry `process` — dropping the pack would take the other
    // six rules with it.
    const onAction = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { container } = render(withInstall(onAction))
    await waitFor(() => expect(sw(container, 'Codes That Persist')).toBeTruthy())
    fireEvent.click(sw(container, 'Codes That Persist'))
    fireEvent.click(applyBtn())
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
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { container } = render(withInstall(onAction))
    await waitFor(() => expect(sw(container, 'Automate Repetition')).toBeTruthy())
    fireEvent.click(sw(container, 'Automate Repetition'))
    fireEvent.click(sw(container, 'English Configuration')) // craft.3 is already off
    fireEvent.click(applyBtn())
    const body = onAction.mock.calls[0][1]
    expect(body.doctrines).toEqual(['process'])
    expect(body.excludeRules).toEqual([])
    vi.restoreAllMocks()
  })

  it('turning every rule off is a real selection, not a no-op', async () => {
    // The server reads `[]` as a deliberate `--doctrines none` and anything falsier as
    // "unspecified", which resolves to ALL packs — so an empty list must arrive as an empty list.
    const onAction = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { container } = render(withInstall(onAction))
    await waitFor(() => expect(sw(container, 'Automate Repetition')).toBeTruthy())
    for (const name of ['Automate Repetition', 'English Configuration', 'Consent Before Push',
      'Codes That Persist']) {
      fireEvent.click(sw(container, name))
    }
    fireEvent.click(applyBtn())
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
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { container } = render(withInstall(onAction))
    await waitFor(() => expect(sw(container, 'Codes That Persist')).toBeTruthy())
    fireEvent.click(sw(container, 'Codes That Persist'))
    fireEvent.click(applyBtn())
    expect(confirm.mock.calls[0][0]).not.toMatch(/consent/) // a sibling rule costs no gate
    fireEvent.click(sw(container, 'Consent Before Push'))
    fireEvent.click(applyBtn())
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
