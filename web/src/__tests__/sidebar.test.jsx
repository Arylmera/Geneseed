import React from 'react'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

import Sidebar, { TabBar } from '../components/Sidebar.jsx'
import VoicePopover from '../components/VoicePopover.jsx'
import { ConfirmContext } from '../hooks/useConfirm.jsx'

const overview = {
  counts: {
    agents: 18,
    skills: 52,
    laws: 11,
    ontology: 4,
    doctrines: { active: 5, total: 5, rules: 28 },
    memory: 2,
    notebook: 2,
    wiki: 0,
    config: 2,
    loops: 3,
  },
  theme: 'imperial',
  version: '3.8.0',
  doctor: { ok: true, problems: [] },
  diff: { edited: 1, added: 0, missing: 1 },
}
const installs = [
  { id: 'a', state: 'active' },
  { id: 'b', state: 'absent' },
  { id: 'c', state: 'disabled' },
]

const row = (label) => screen.getByText(label).closest('a')

describe('Sidebar', () => {
  it('lists the seven pages in order, then Docs and Activity', () => {
    render(<Sidebar route={{ page: 'overview' }} overview={overview} installs={installs} />)
    expect([...document.querySelectorAll('a.sb-item .sb-label')].map((n) => n.textContent)).toEqual(
      [
        'Overview',
        'Constitution',
        'Library',
        'Kits',
        'Loops',
        'Personal',
        'Installs',
        'Docs',
        'Activity',
      ],
    )
  })

  // Each count is a sum the overview already holds, written out:
  //   Constitution = 4 ethos + 11 invariants (counts.laws) + 28 doctrine = 43
  //   Library      = 52 skills + 18 agents + 2 memory + 2 notebook + 0 wiki + 2 setup = 76
  //   Loops        = templates only (counts.loops), not bricks = 3
  //   Installs     = active of detected, from the installs list = 1/3
  it('counts what each page lists', () => {
    render(<Sidebar route={{ page: 'overview' }} overview={overview} installs={installs} />)
    expect(row('Constitution').querySelector('.sb-count').textContent).toBe('43')
    expect(row('Library').querySelector('.sb-count').textContent).toBe('76')
    expect(row('Loops').querySelector('.sb-count').textContent).toBe('3')
    expect(row('Installs').querySelector('.sb-count').textContent).toBe('1/3')
    // No honest single number for these: no badge rather than an invented one.
    expect(row('Overview').querySelector('.sb-count')).toBeNull()
    expect(row('Personal').querySelector('.sb-count')).toBeNull()
  })

  it('lights the route page, and only it', () => {
    render(<Sidebar route={{ page: 'library', section: 'agents' }} overview={overview} />)
    expect(row('Library').getAttribute('aria-current')).toBe('page')
    expect(document.querySelectorAll('a.sb-item.on')).toHaveLength(1)
  })

  // The vitals: doctor verdict, drift (edited + added + missing = 1 + 0 + 1), the voice.
  it('shows the vitals from the overview', () => {
    render(<Sidebar route={{ page: 'overview' }} overview={overview} />)
    const v = document.querySelector('.sb-vitals')
    expect(v.textContent).toContain('clean')
    expect(v.querySelector('div:nth-child(2) b').textContent).toBe('2')
    expect(
      within(document.querySelector('.sb-vitals')).getByRole('button', {
        name: /switch voice|imperial/i,
      }),
    ).toBeTruthy()
  })

  // One list of nine pages, Docs and Activity included: a screen reader announces "list, 9
  // items", and the spacer sits under the list, above the vitals card, not inside it.
  it('is one list of every page', () => {
    render(<Sidebar route={{ page: 'overview' }} overview={overview} installs={installs} />)
    const lists = screen.getByRole('navigation', { name: 'Console' }).querySelectorAll('ul')
    expect(lists).toHaveLength(1)
    expect(within(lists[0]).getAllByRole('listitem')).toHaveLength(9)
  })

  // The vitals are a card a landmark list can reach by name; the voice button opens the
  // voice dialog, which it announces.
  it('puts the vitals in a named card whose voice button opens a dialog', () => {
    render(<Sidebar route={{ page: 'overview' }} overview={overview} />)
    const card = screen.getByRole('region', { name: 'Install vitals' })
    expect(card.classList.contains('sb-vitals')).toBe(true)
    expect(
      within(card)
        .getByRole('button', { name: /voice · imperial/i })
        .getAttribute('aria-haspopup'),
    ).toBe('dialog')
  })

  // At tablet width (721-960px) the rail is icons only and hides the vitals, voice button
  // included: this icon button is the voice switch there. CSS shows it in that tier only.
  it('carries an icon voice button outside the vitals, naming the current voice', () => {
    const onOpenVoice = vi.fn()
    render(<Sidebar route={{ page: 'overview' }} overview={overview} onOpenVoice={onOpenVoice} />)
    const btn = screen.getByRole('button', { name: 'Switch voice, now imperial' })
    expect(btn.closest('.sb-vitals')).toBeNull()
    fireEvent.click(btn)
    expect(onOpenVoice).toHaveBeenCalledTimes(1)
  })
})

// A voice switch rebuilds the deployed harness, so the pick is confirmed first; the list is
// a dialog of toggle buttons, not a menu (it has no menu keyboard model).
describe('VoicePopover', () => {
  const themes = [
    { name: 'imperial', accent: 'gold' },
    { name: 'plain', accent: 'blue' },
  ]
  const mount = (answer) => {
    const ask = vi.fn(async () => answer)
    const onPick = vi.fn()
    render(
      <ConfirmContext.Provider value={ask}>
        <VoicePopover themes={themes} current="imperial" onPick={onPick} onClose={() => {}} />
      </ConfirmContext.Provider>,
    )
    return { ask, onPick }
  }

  it('asks before rebuilding, and a No rebuilds nothing', async () => {
    const { ask, onPick } = mount(false)
    await act(async () => fireEvent.click(screen.getByText('plain').closest('button')))
    expect(ask).toHaveBeenCalledTimes(1)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('a Yes picks the voice', async () => {
    const { onPick } = mount(true)
    await act(async () => fireEvent.click(screen.getByText('plain').closest('button')))
    expect(onPick).toHaveBeenCalledWith('plain')
  })

  // The switch rebuilds ONE install: with two active, the popover's own "Rebuild:" picker names
  // it, a change of pick goes to the caller, and the confirm names the install it rebuilds.
  it('names and picks the install it rebuilds', async () => {
    const ask = vi.fn(async () => true)
    const onInstall = vi.fn()
    const two = [
      { id: 'oc', host: 'opencode', scope: 'global', path: '/oc', state: 'active' },
      { id: 'r', host: 'bob', scope: 'project', path: '/x/repo', state: 'active' },
    ]
    render(
      <ConfirmContext.Provider value={ask}>
        <VoicePopover
          themes={themes}
          current="imperial"
          onPick={() => {}}
          onClose={() => {}}
          installs={two}
          install={two[1]}
          onInstall={onInstall}
        />
      </ConfirmContext.Provider>,
    )
    const pick = screen.getByRole('combobox', { name: 'Rebuild:' })
    expect(pick.value).toBe('r')
    fireEvent.change(pick, { target: { value: 'oc' } })
    expect(onInstall).toHaveBeenCalledWith(two[0])
    await act(async () => fireEvent.click(screen.getByText('plain').closest('button')))
    expect(ask.mock.calls[0][0]).toBe(
      'Rebuild repo · bob in the “plain” voice? It rebuilds in place, non-destructive.',
    )
  })

  // The accent is the skin's own (or the reader's pick), never the voice's: every skin has a
  // curated colour, so a dot in the voice's colour promised a tint that never arrived.
  it('paints no accent dot beside a voice', () => {
    mount(true)
    expect(screen.getByRole('dialog').querySelector('.po')).toBeNull()
  })

  it('is a labelled dialog of pressed buttons, not a menu', () => {
    mount(true)
    expect(screen.queryByRole('menu')).toBeNull()
    const dlg = screen.getByRole('dialog', { name: 'Switch voice' })
    expect(within(dlg).getByRole('button', { name: 'imperial' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })
})

// The phone bar: five cells, so each holds its full label at 360px (~72px a cell). The four
// pages a visit starts from, then More, which opens the drawer holding every page.
describe('TabBar', () => {
  it('carries four pages with their full names, then More', () => {
    render(<TabBar route={{ page: 'library' }} />)
    const links = [...document.querySelectorAll('nav.tabbar a')]
    expect(links.map((a) => a.textContent)).toEqual([
      'Overview',
      'Constitution',
      'Library',
      'Installs',
    ])
    expect(links[2].getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: 'More' }).classList.contains('on')).toBe(false)
  })

  it('More opens the drawer, and is lit on a page only the drawer lists', () => {
    const onMore = vi.fn()
    render(<TabBar route={{ page: 'loops' }} navOpen={false} onMore={onMore} />)
    const more = screen.getByRole('button', { name: 'More' })
    expect(more.getAttribute('aria-controls')).toBe('rail-nav')
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(more.classList.contains('on')).toBe(true)
    fireEvent.click(more)
    expect(onMore).toHaveBeenCalledTimes(1)
  })
})
