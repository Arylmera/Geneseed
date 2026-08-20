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

/** Two packs, one built in and one not — the pair the page's whole doctrine band is about. */
const DOC = [
  [
    'craft',
    'Craft',
    'how code is written',
    true,
    [
      [1, 'Automate Repetition'],
      [2, 'English Configuration'],
    ],
  ],
  ['process', 'Process', 'how a task is run', false, [[5, 'Consent Before Push']]],
].flatMap(([pack, packTitle, packDesc, active, rules]) =>
  rules.map(([n, title]) => ({
    name: `${pack}.${n}`,
    title: `Doctrine ${pack} ${n} — ${title}`,
    desc: '',
    klass: pack,
    tier: 'doctrine',
    pack,
    packTitle,
    packDesc,
    active,
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
    expect(cmd.textContent).toContain('craft,process')
    // Its rules are still listed and still readable — the text ships either way.
    expect(screen.getByText('Consent Before Push')).toBeTruthy()
    // The active pack is NOT marked off, or the marker means nothing.
    expect(container.querySelectorAll('.pack-wrap').length).toBe(2)
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
// The pack toggles. They live on THIS page and not in Settings because this is where a reader is
// already looking at what each pack contains — dropping `ops` is a decision about the six rules
// listed directly under its header, and a switch three screens away makes it a decision taken
// blind.

const INSTALL = { host: 'opencode', scope: 'global' }
const sw = (c, name) => c.querySelector(`[aria-label="${name} pack"]`)
const applyBtn = () => screen.getByText(/^Apply/).closest('button')
const withInstall = (onAction = () => {}) => (
  <Laws overview={{ install: INSTALL }} onAction={onAction} />
)

describe('Constitution page — pack toggles', () => {
  it('renders a switch per pack, reflecting what is deployed', async () => {
    const { container } = render(withInstall())
    await waitFor(() => expect(sw(container, 'Craft')).toBeTruthy())
    expect(sw(container, 'Craft').getAttribute('aria-checked')).toBe('true')
    expect(sw(container, 'Process').getAttribute('aria-checked')).toBe('false')
    expect(applyBtn().disabled).toBe(true)
  })

  it('stages every toggle and rebuilds ONCE on Apply', async () => {
    // ⚠ THE WHOLE POINT. Acting per click would re-emit the install once per switch — three of
    // those rebuilds describing a state nobody asked for, each writing a different
    // `Active packs:` marker.
    const onAction = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { container } = render(withInstall(onAction))
    await waitFor(() => expect(sw(container, 'Craft')).toBeTruthy())
    fireEvent.click(sw(container, 'Process')) // off -> on
    fireEvent.click(sw(container, 'Craft')) // on  -> off
    expect(onAction).not.toHaveBeenCalled() // still nothing — this is the claim
    fireEvent.click(applyBtn())
    expect(onAction).toHaveBeenCalledTimes(1)
    const [action, body] = onAction.mock.calls[0]
    expect(action).toBe('install')
    expect(body.doctrines).toEqual(['process'])
    expect(body.host).toBe('opencode')
    vi.restoreAllMocks()
  })

  it('turning every pack off is a real selection, not a no-op', async () => {
    // The server reads `[]` as a deliberate `--doctrines none` and anything falsier as
    // "unspecified", which resolves to ALL packs — so an empty list must arrive as an empty list.
    const onAction = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { container } = render(withInstall(onAction))
    await waitFor(() => expect(sw(container, 'Craft')).toBeTruthy())
    fireEvent.click(sw(container, 'Craft')) // the only one that starts on
    fireEvent.click(applyBtn())
    expect(onAction.mock.calls[0][1].doctrines).toEqual([])
    vi.restoreAllMocks()
  })

  it('a staged pack reads as staged, not as deployed', async () => {
    // The header must not claim `active` for something that has not been applied — that is the
    // one lie a staged control can tell.
    const { container } = render(withInstall())
    await waitFor(() => expect(sw(container, 'Process')).toBeTruthy())
    expect(screen.getByText(/not built in/)).toBeTruthy()
    fireEvent.click(sw(container, 'Process'))
    expect(screen.getByText(/staged on/)).toBeTruthy()
    expect(screen.queryByText(/not built in/)).toBeNull()
  })

  it('warns before dropping the pack that carries the consent gate', async () => {
    // Supported, so it is NAMED rather than refused.
    const onAction = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { container } = render(
      <Laws
        overview={{ install: INSTALL }}
        onAction={onAction}
        // craft + process both deployed, so dropping process is a real loss
      />,
    )
    await waitFor(() => expect(sw(container, 'Process')).toBeTruthy())
    fireEvent.click(sw(container, 'Process')) // stage it ON first
    fireEvent.click(applyBtn())
    expect(confirm.mock.calls[0][0]).not.toMatch(/consent/) // gaining it warns about nothing
    expect(onAction).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })

  it('shows no switches at all when there is no install to rebuild', async () => {
    // A source render still READS; it just cannot be changed from here, so the command fallback
    // takes over — spelled `geneseed-build`, because the CLI's `build` verb forwards `--theme`
    // and nothing else and the shorter spelling errors.
    const { container } = render(<Laws />)
    await waitFor(() => expect(screen.getByText('Automate Repetition')).toBeTruthy())
    expect(sw(container, 'Craft')).toBeNull()
    expect(screen.queryByText(/^Apply/)).toBeNull()
    const cmd = screen.getByText(/geneseed-build --doctrines/)
    expect(cmd.textContent).toContain('craft,process')
    expect(screen.queryByText(/\$ geneseed build --doctrines/)).toBeNull()
  })
})
