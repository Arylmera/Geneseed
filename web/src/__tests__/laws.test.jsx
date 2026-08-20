import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
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
    const { container } = render(<Laws />)
    await waitFor(() => expect(container.querySelector('.pack-wrap')).toBeTruthy())
    expect(screen.getByText(/not built in/)).toBeTruthy()
    expect(container.querySelector('.pack-wrap.pack-off')).toBeTruthy()
    const cmd = screen.getByText(/geneseed build --doctrines/)
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
