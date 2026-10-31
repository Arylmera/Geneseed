import React from 'react'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// A write to one of the user's own files (user-rules.md, PROFILE.md) reloads that file's
// read and nothing else: not the other personal file, not /api/overview, not /api/fleet.
// And user-rules.md is read under ONE useAsync key ('rules', hooks/useRules.js) by
// Personal's cards, the Overview's ledger and the Constitution page, so the copy a write
// reloads on Personal is the copy the other two are served at once. That read is
// stale-while-revalidate: each mount paints the cached copy, then refetches once, because
// agent sessions write user-rules.md behind the console's back.
//
// The rules file is simulated by `ruleCount`: every write moves it, every read reports it.

const { state } = vi.hoisted(() => ({ state: { ruleCount: 1 } }))
const rulesPayload = () => ({
  exists: true,
  fingerprint: `f${state.ruleCount}`,
  stats: { rules: state.ruleCount, lines: 10, tokens: 200, max_rules: 15, max_tokens: 1500 },
  rules: [],
})

vi.mock('../api/index.js', () => ({
  api: {
    rules: vi.fn(),
    rulesMutate: vi.fn(),
    rulesPromote: vi.fn(),
    profile: vi.fn(),
    profileSave: vi.fn(),
    catalog: vi.fn(),
    item: vi.fn(),
    memoryDelete: vi.fn(),
    overview: vi.fn(),
    fleet: vi.fn(),
    usage: vi.fn(),
    gates: vi.fn(),
    update: vi.fn(),
    activity: vi.fn(),
  },
}))

// The two editors stand in as one button each that performs the write the real editor
// performs, then calls `onChanged` exactly as Rules.jsx / Profile.jsx do after a write.
vi.mock('../pages/Rules.jsx', async () => {
  const { api } = await import('../api/index.js')
  return {
    default: ({ onChanged }) => (
      <button
        type="button"
        onClick={async () => {
          await api.rulesMutate({ action: 'retire', id: 1 })
          onChanged?.()
        }}
      >
        retire a rule
      </button>
    ),
  }
})
vi.mock('../pages/Profile.jsx', async () => {
  const { api } = await import('../api/index.js')
  return {
    default: ({ onChanged }) => (
      <button
        type="button"
        onClick={async () => {
          await api.profileSave({ text: 'me', fingerprint: 'p1' })
          onChanged?.()
        }}
      >
        save profile
      </button>
    ),
  }
})

const { askConfirm } = vi.hoisted(() => ({ askConfirm: vi.fn(async () => true) }))
vi.mock('../hooks/useConfirm.jsx', () => ({ useConfirm: () => askConfirm }))

import Personal from '../pages/Personal.jsx'
import Ledger from '../pages/Overview/Ledger.jsx'
import Laws from '../pages/Laws.jsx'
import Library from '../pages/Library.jsx'
import { api } from '../api/index.js'

beforeEach(() => {
  vi.clearAllMocks()
  state.ruleCount = 1
  api.rules.mockImplementation(() => Promise.resolve(rulesPayload()))
  api.rulesMutate.mockImplementation(() => {
    state.ruleCount -= 1
    return Promise.resolve({ ok: true })
  })
  api.rulesPromote.mockImplementation(() => {
    state.ruleCount += 1
    return Promise.resolve({ ok: true })
  })
  api.profile.mockImplementation(() =>
    Promise.resolve({ exists: true, seeded: false, fingerprint: 'p1', text: 'me' }),
  )
  api.profileSave.mockImplementation(() => Promise.resolve({ ok: true }))
  api.catalog.mockImplementation((section) =>
    Promise.resolve({
      section,
      items: section === 'memory' ? [{ name: 'fact-a', title: 'fact-a', desc: '' }] : [],
    }),
  )
  // The read names its entry: Forget and Promote act only on the copy that answers it.
  api.item.mockImplementation((type, name) =>
    Promise.resolve({ name, title: 'fact-a', desc: '', body: 'body', links: [] }),
  )
  for (const k of ['overview', 'fleet', 'usage', 'gates', 'update', 'activity']) {
    api[k].mockImplementation(() => Promise.resolve(null))
  }
})

// Personal's "Rule slots" card reads `<n> of 15`.
const slots = (n) => screen.findByText(`${n} of 15`)

describe('user-file writes reload only their own data', () => {
  it('a rules write refetches /api/rules once, and not the profile, overview or fleet', async () => {
    render(<Personal tab="rules" dataRev={0} />)
    await slots(1)
    expect(api.rules).toHaveBeenCalledTimes(1)
    expect(api.profile).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('retire a rule'))
    await slots(0)
    expect(api.rules).toHaveBeenCalledTimes(2)
    expect(api.profile).toHaveBeenCalledTimes(1)
    expect(api.overview).not.toHaveBeenCalled()
    expect(api.fleet).not.toHaveBeenCalled()
  })

  it('a profile save refetches /api/profile once, and not the rules, overview or fleet', async () => {
    render(<Personal tab="profile" dataRev={0} />)
    fireEvent.click(await screen.findByText('save profile'))
    await waitFor(() => expect(api.profile).toHaveBeenCalledTimes(2))
    await act(async () => {})
    expect(api.rules).toHaveBeenCalledTimes(1)
    expect(api.overview).not.toHaveBeenCalled()
    expect(api.fleet).not.toHaveBeenCalled()
  })

  // The mount refetch below is held pending, so what renders is the cached copy alone.
  const holdRefetch = () => api.rules.mockImplementation(() => new Promise(() => {}))

  it('after a rules write on Personal, the Overview ledger paints the written rules from cache', async () => {
    const { unmount } = render(<Personal tab="rules" dataRev={0} />)
    await slots(1)
    fireEvent.click(screen.getByText('retire a rule'))
    await slots(0)
    unmount()

    holdRefetch()
    render(<Ledger overview={{ counts: {} }} setup={null} onAction={() => {}} dataRev={0} />)
    // 0 rules raises the ledger's "No standing rules yet" — only the post-write copy can.
    expect(await screen.findByText('No standing rules yet')).toBeTruthy()
    // Personal's mount + its write's reload + the ledger's one mount refetch.
    expect(api.rules).toHaveBeenCalledTimes(3)
  })

  it('after a rules write on Personal, the Constitution page paints the written rules from cache', async () => {
    const { unmount } = render(<Personal tab="rules" dataRev={0} />)
    await slots(1)
    fireEvent.click(screen.getByText('retire a rule'))
    await slots(0)
    unmount()

    holdRefetch()
    render(<Laws overview={{ counts: {} }} setup={null} onAction={() => {}} dataRev={0} />)
    // The "Your rules" tier: `<rules> of <max> · <tokens>/<max> tok`.
    expect(await screen.findByText('0 of 15 · 200/1500 tok')).toBeTruthy()
    expect(api.rules).toHaveBeenCalledTimes(3)
  })

  it('a rules file changed outside the console shows on the next page mount, each page', async () => {
    const first = render(<Personal tab="rules" dataRev={0} />)
    await slots(1)
    first.unmount()
    state.ruleCount = 3 // an agent session's rule skill wrote two rules

    const laws = render(
      <Laws overview={{ counts: {} }} setup={null} onAction={() => {}} dataRev={0} />,
    )
    expect(await screen.findByText('3 of 15 · 200/1500 tok')).toBeTruthy()
    laws.unmount()

    state.ruleCount = 0
    const ledger = render(
      <Ledger overview={{ counts: {} }} setup={null} onAction={() => {}} dataRev={0} />,
    )
    expect(await screen.findByText('No standing rules yet')).toBeTruthy()
    ledger.unmount()

    state.ruleCount = 4
    render(<Personal tab="rules" dataRev={0} />)
    await slots(4)
    // One fetch per mount: Personal, Laws, Ledger, Personal.
    expect(api.rules).toHaveBeenCalledTimes(4)
  })

  it('a promote from the Library drops the cached rules, so Personal shows the promoted rule', async () => {
    const first = render(<Personal tab="rules" dataRev={0} />)
    await slots(1)
    first.unmount()

    const lib = render(
      <Library
        lock="memory"
        base="#/personal/memory"
        selected="fact-a"
        overview={{ counts: {} }}
      />,
    )
    fireEvent.click(await screen.findByText('Promote to rule'))
    await waitFor(() => expect(api.rulesPromote).toHaveBeenCalledTimes(1))
    await act(async () => {})
    lib.unmount()

    render(<Personal tab="rules" dataRev={0} />)
    // Not even for one frame: the pre-promote copy was dropped, not served stale.
    expect(screen.queryByText('1 of 15')).toBeNull()
    await slots(2)
  })

  it('a promote from Personal’s own Memory tab updates the cards when it lands on the Rules tab', async () => {
    // Personal stays mounted across its tabs (App keys the slot by page, not tab), so
    // dropping the cache alone would leave the mounted cards on the pre-promote copy.
    const view = render(<Personal tab="memory" item="fact-a" dataRev={0} />)
    fireEvent.click(await screen.findByText('Promote to rule'))
    await waitFor(() => expect(api.rulesPromote).toHaveBeenCalledTimes(1))
    await act(async () => {})
    view.rerender(<Personal tab="rules" dataRev={0} />)
    await slots(2)
  })
  it('a rules write reaches every mounted consumer of the shared key, not only its own', async () => {
    render(
      <>
        <Personal tab="rules" dataRev={0} />
        <Laws overview={{ counts: {} }} setup={null} onAction={() => {}} dataRev={0} />
      </>,
    )
    expect(await screen.findByText('1 of 15 · 200/1500 tok')).toBeTruthy()
    fireEvent.click(screen.getByText('retire a rule'))
    // Only Personal's read reloads; Laws is told by the landing fetch.
    expect(await screen.findByText('0 of 15 · 200/1500 tok')).toBeTruthy()
  })
})
