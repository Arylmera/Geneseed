import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/index.js', () => ({
  api: {
    activeLoops: vi.fn(() => Promise.resolve({ loops: [] })),
    activeFactories: vi.fn(() => Promise.resolve({ factories: [] })),
    catalog: vi.fn(() => Promise.resolve({ items: [] })),
    item: vi.fn(),
    usage: vi.fn(() => Promise.resolve(null)),
    loadout: vi.fn(() => Promise.resolve(null)),
    agentModels: vi.fn(),
    excludes: vi.fn(() => Promise.resolve({ patterns: [] })),
  },
}))

import Sidebar, { TabBar } from '../components/Sidebar.jsx'
import Tabs from '../components/Tabs.jsx'
import Library, { resolveSec } from '../pages/Library.jsx'
import Settings from '../pages/Settings/index.jsx'
import InstallPanel from '../pages/Installs/InstallPanel.jsx'
import { ViewLevelProvider } from '../hooks/useViewLevel.jsx'

const at = (level, ui) => {
  localStorage.setItem('geneseed-view-level', level)
  return render(<ViewLevelProvider>{ui}</ViewLevelProvider>)
}
const rail = () => [...document.querySelectorAll('a.sb-item .sb-label')].map((n) => n.textContent)
const sorted = (a) => [...a].sort()

describe('view level filters the surfaces', () => {
  beforeEach(() => localStorage.clear())

  it('Essentials rail', () => {
    at('essentials', <Sidebar route={{ page: 'overview' }} />)
    expect(sorted(rail())).toEqual(
      sorted(['Overview', 'Constitution', 'Library', 'Personal', 'Installs', 'Docs', 'Settings']),
    )
  })

  it('Essentials rail keeps the lit page above the level', () => {
    at('essentials', <Sidebar route={{ page: 'loops' }} />)
    expect(rail()).toContain('Loops')
    expect(rail()).not.toContain('Kits')
    expect(screen.queryByText('Run')).not.toBeNull()
  })

  it('Standard rail adds Kits and Activity', () => {
    at('standard', <Sidebar route={{ page: 'overview' }} />)
    expect(sorted(rail())).toEqual(
      sorted([
        'Overview',
        'Library',
        'Personal',
        'Installs',
        'Docs',
        'Settings',
        'Kits',
        'Activity',
        'Constitution',
      ]),
    )
  })

  it('Power rail has every page', () => {
    at('power', <Sidebar route={{ page: 'overview' }} />)
    expect(rail()).toHaveLength(12)
  })

  it('Essentials tab bar', () => {
    at('essentials', <TabBar route={{ page: 'overview' }} />)
    const bar = screen.getByRole('navigation', { name: 'Console pages' })
    for (const t of ['Overview', 'Constitution', 'Library', 'Installs', 'More'])
      expect(within(bar).getByText(t)).toBeTruthy()
  })

  it('Tabs show visible tabs plus the current one', () => {
    const labels = () => [...document.querySelectorAll('nav.tabs a')].map((a) => a.textContent)
    const { unmount } = at('essentials', <Tabs page="personal" current="rules" />)
    expect(labels()).toEqual(['Rules', 'Profile', 'Memory'])
    unmount()
    at('essentials', <Tabs page="personal" current="notebook" />)
    expect(labels()).toEqual(['Rules', 'Profile', 'Memory', 'Notebook'])
  })

  it('Library at Essentials lists Skills and Agents and defaults to Skills', () => {
    at('essentials', <Library overview={{ counts: {} }} />)
    const kinds = screen.getByRole('navigation', { name: 'Kinds' })
    expect([...kinds.querySelectorAll('a')].map((a) => a.textContent.replace(/\d+$/, ''))).toEqual([
      'Skills',
      'Agents',
    ])
    expect(kinds.querySelector('a.on').textContent).toMatch(/^Skills/)
  })

  it('Library keeps the route kind when it is hidden', () => {
    at('essentials', <Library section="wiki" overview={{ counts: {} }} />)
    const kinds = screen.getByRole('navigation', { name: 'Kinds' })
    expect([...kinds.querySelectorAll('a')].map((a) => a.textContent.replace(/\d+$/, ''))).toEqual([
      'Skills',
      'Agents',
      'Wiki',
    ])
  })

  it('resolveSec defaults to the first visible kind, not the first kind', () => {
    expect(resolveSec(undefined, undefined, ['agents', 'wiki'])).toBe('agents')
    expect(resolveSec('config', undefined, ['agents', 'wiki'])).toBe('config')
  })

  it('Settings hides the Danger zone below Power', () => {
    const { unmount } = at('standard', <Settings onAction={() => {}} />)
    expect(screen.queryAllByText('Danger zone')).toHaveLength(0)
    unmount()
    at('power', <Settings onAction={() => {}} />)
    expect(screen.getAllByText('Danger zone').length).toBeGreaterThan(0)
  })

  // Essentials keeps the two picks a newcomer weighs (how big, how chatty); the voice, the
  // mode, loop trust and the context window wait for Standard.
  it('install panel shows only Footprint and Posture at Essentials', () => {
    const inst = { id: 'c', host: 'claude', scope: 'global', state: 'active', path: '/c' }
    const choice = {
      theme: 'imperial',
      footprint: 'lean',
      posture: 'expert',
      mode: 'foreman',
      trust: 'balanced',
      contextWindow: '1m',
    }
    const options = {
      theme: ['imperial'],
      footprint: ['lean', 'full'],
      posture: ['expert'],
      mode: ['foreman'],
      trust: ['balanced'],
    }
    const panel = (level) =>
      at(
        level,
        <InstallPanel
          inst={inst}
          targets={[]}
          choice={choice}
          options={options}
          onPick={() => {}}
          canAct
        />,
      )
    const fields = () =>
      [...document.querySelectorAll('.dp-field > span')].map((n) => n.textContent)
    const { unmount } = panel('essentials')
    expect(fields()).toEqual(['Footprint', 'Posture'])
    unmount()
    panel('standard')
    expect(fields()).toEqual([
      'Voice',
      'Footprint',
      'Posture',
      'Mode',
      'Loop trust',
      'Context window',
    ])
  })
})
