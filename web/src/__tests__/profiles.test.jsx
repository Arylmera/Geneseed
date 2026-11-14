import React from 'react'
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api/index.js', () => ({ api: { profiles: vi.fn(), pickFolder: vi.fn() } }))

import Profiles, { saveHash, saveRequestOf } from '../pages/Installs/Profiles.jsx'
import { api } from '../api/index.js'
import { clearAsyncCache } from '../hooks/useAsync.js'

// Installs › Profiles (spec D38, D39): the cards, the Apply panel and the Save panel. The server
// owns every fact (js/web/profiles-api.mjs), so each test hands in its answer and reads what the
// page shows and what it sends.

const STARTER = {
  hosts: ['opencode', 'bob', 'claude', 'openclaude'],
  theme: 'neutral',
  footprint: 'lean',
  posture: 'peer',
  mode: 'direct',
  trust: 'balanced',
}
const LIST = {
  base: 'starter',
  personalDir: '/home/u/.config/geneseed/profiles',
  shippedWritable: true,
  installs: [
    {
      host: 'claude',
      scope: 'global',
      path: '/home/u/.claude',
      matches: ['mine'],
      diff: [
        { key: 'gates.deletionGate', base: 'on', now: 'off' },
        { key: 'hosts', base: 'bob,claude,openclaude,opencode', now: 'claude' },
        { key: 'theme', base: 'neutral', now: 'imperial' },
      ],
    },
    { host: 'opencode', scope: 'project', path: '/work/api', matches: [], diff: [] },
  ],
  profiles: [
    {
      name: 'starter',
      source: 'shipped',
      file: '/gs/profiles/starter.json',
      description: 'For a first install.',
      profile: STARTER,
      gatesOff: ['ownershipGate'],
      matches: [],
    },
    {
      name: 'mine',
      source: 'personal',
      file: '/home/u/.config/geneseed/profiles/mine.json',
      description: '',
      profile: { ...STARTER, hosts: ['claude', 'bob'], theme: 'imperial' },
      gatesOff: ['deletionGate', 'externalGate'],
      matches: [{ host: 'claude', scope: 'global', path: '/home/u/.claude' }],
    },
    {
      name: 'starter',
      source: 'personal',
      file: '/home/u/.config/geneseed/profiles/starter.json',
      shadowed: true,
      error: 'a shipped profile has this name, so this file is never loaded — rename it',
    },
  ],
}
const card = (name, source) =>
  screen
    .getAllByRole('article')
    .find(
      (a) =>
        a.getAttribute('aria-label') === `profile ${name}` &&
        within(a).queryByText(source === 'personal' ? 'Personal' : 'Shipped'),
    )

beforeEach(() => {
  clearAsyncCache()
  api.profiles.mockReset()
  api.pickFolder.mockReset()
})

describe('Installs › Profiles', () => {
  it('shows each profile with its source, hosts, settings, gates and who follows it', async () => {
    api.profiles.mockResolvedValue(LIST)
    render(<Profiles onAction={() => {}} />)
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(3))
    const starter = card('starter', 'shipped')
    expect(within(starter).getByText('neutral · lean · peer · direct · balanced')).toBeTruthy()
    expect(within(starter).getByText('All on, except ownership')).toBeTruthy()
    expect(within(starter).getByText('No install')).toBeTruthy()
    const mine = card('mine', 'personal')
    expect(within(mine).getByText('! Off: deletion, external')).toBeTruthy()
    expect(within(mine).getByText('Claude Code · global')).toBeTruthy()
    // A Personal file under a Shipped name says why it is never loaded, and offers no Apply.
    const shadowed = card('starter', 'personal')
    expect(within(shadowed).getByText(/never loaded/)).toBeTruthy()
    expect(within(shadowed).queryByRole('button', { name: 'Apply…' })).toBeNull()
  })

  it('a read-only console shows the profiles and offers no Apply or Save', async () => {
    api.profiles.mockResolvedValue(LIST)
    render(<Profiles />)
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(3))
    expect(screen.queryByRole('button', { name: 'Apply…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save an install as profile…' })).toBeNull()
  })

  it('applies globally to the ticked hosts, with each change shown and a missing host not offered', async () => {
    api.profiles.mockImplementation((name) =>
      Promise.resolve(
        name
          ? {
              ...LIST,
              preview: {
                name,
                scope: 'global',
                project: null,
                rows: [
                  { host: 'bob', present: false, state: 'absent', changes: [], layering: null },
                  {
                    host: 'claude',
                    present: true,
                    state: 'active',
                    changes: [
                      { name: 'theme', from: 'neutral', to: 'imperial' },
                      { name: 'deletion-gate', from: 'on', to: 'off' },
                    ],
                    layering: null,
                  },
                ],
              },
            }
          : LIST,
      ),
    )
    const onAction = vi.fn(async () => 'j1')
    render(<Profiles onAction={onAction} />)
    await waitFor(() => expect(card('mine', 'personal')).toBeTruthy())
    fireEvent.click(within(card('mine', 'personal')).getByRole('button', { name: 'Apply…' }))
    const dialog = await screen.findByRole('region', { name: 'Apply profile' })
    await waitFor(() => expect(within(dialog).getByText('theme neutral → imperial')).toBeTruthy())
    expect(api.profiles).toHaveBeenCalledWith('mine', null)
    expect(within(dialog).getByText('deletion-gate on → off').className).toBe('warn-text')
    const boxes = within(dialog).getAllByRole('checkbox')
    expect(boxes.map((b) => [b.checked, b.disabled])).toEqual([
      [false, true],
      [true, false],
    ])
    expect(within(dialog).getByText('Install BOB (IBM), then apply again')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply to 1 host' }))
    await act(async () => {})
    expect(onAction).toHaveBeenCalledWith('profile-apply', { name: 'mine', hosts: ['claude'] })
    // The job was accepted, so the panel closes.
    expect(screen.queryByRole('region', { name: 'Apply profile' })).toBeNull()
  })

  it('applies to one project folder, warning that the active global install keeps its gates (D39)', async () => {
    api.profiles.mockImplementation((name, project) =>
      Promise.resolve(
        name && project
          ? {
              ...LIST,
              preview: {
                name,
                scope: 'project',
                project: '/work/api',
                rows: [
                  {
                    host: 'claude',
                    present: true,
                    state: 'absent',
                    changes: [],
                    layering: { root: '/home/u/.claude', gates: ['Secrets gate', 'Test note'] },
                  },
                ],
              },
            }
          : LIST,
      ),
    )
    const onAction = vi.fn(async () => null)
    render(<Profiles onAction={onAction} />)
    await waitFor(() => expect(card('mine', 'personal')).toBeTruthy())
    fireEvent.click(within(card('mine', 'personal')).getByRole('button', { name: 'Apply…' }))
    const dialog = await screen.findByRole('region', { name: 'Apply profile' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'One project' }))
    // No folder yet: nothing to apply.
    expect(within(dialog).getByRole('button', { name: 'Apply to 0 hosts' }).disabled).toBe(true)
    const input = within(dialog).getByLabelText('Project folder')
    fireEvent.change(input, { target: { value: ' /work/api ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(within(dialog).getByText('New install')).toBeTruthy())
    expect(api.profiles).toHaveBeenLastCalledWith('mine', '/work/api')
    expect(within(dialog).getByRole('note').textContent).toMatch(
      /A global Claude Code install is active \(\/home\/u\/\.claude\): both root files load in this project\. Global gates that still run there: Secrets gate, Test note\./,
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply to 1 host' }))
    await act(async () => {})
    expect(onAction).toHaveBeenCalledWith('profile-apply', {
      name: 'mine',
      hosts: ['claude'],
      project: '/work/api',
    })
    // A refused job (no id) keeps the panel open.
    expect(screen.getByRole('region', { name: 'Apply profile' })).toBeTruthy()
  })

  it('saves an install as a personal profile, showing its difference from starter, gates first', async () => {
    api.profiles.mockResolvedValue(LIST)
    const onAction = vi.fn(async () => 'j2')
    render(<Profiles onAction={onAction} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save an install as profile…' }))
    const dialog = screen.getByRole('region', { name: 'Save as profile' })
    const diff = within(dialog).getByLabelText('Differs from starter')
    expect([...diff.children].map((c) => c.textContent)).toEqual([
      'Differs from starter',
      '! gate deletion: off (starter: on)',
      'theme imperial (starter: neutral)',
    ])
    expect(within(dialog).getByRole('button', { name: 'Save profile' }).disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: ' team ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save profile' }))
    await act(async () => {})
    expect(onAction).toHaveBeenCalledWith('profile-save', {
      name: 'team',
      from: { host: 'claude', path: '/home/u/.claude' },
    })
  })

  it('a Save link opens the panel on its install; Shipped and Replace ride the body', async () => {
    api.profiles.mockResolvedValue({ ...LIST, shippedWritable: true })
    const onAction = vi.fn(async () => 'j3')
    const item = decodeURIComponent(
      saveHash({ host: 'opencode', path: '/work/api' }).slice('#/installs/profiles/'.length),
    )
    render(<Profiles onAction={onAction} item={item} />)
    const dialog = await screen.findByRole('region', { name: 'Save as profile' })
    expect(within(dialog).getByLabelText('From install').value).toBe('opencode|/work/api')
    expect(within(dialog).getByText(/: nothing$/)).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'api' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: /Shipped/ }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Replace/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save profile' }))
    await act(async () => {})
    expect(onAction).toHaveBeenCalledWith('profile-save', {
      name: 'api',
      from: { host: 'opencode', path: '/work/api' },
      shipped: true,
      force: true,
    })
  })

  it('a Save link to an install that is gone picks none, says so, and saves nothing', async () => {
    api.profiles.mockResolvedValue(LIST)
    const onAction = vi.fn(async () => 'j4')
    const item = JSON.stringify({ save: { host: 'bob', path: '/gone' } })
    render(<Profiles onAction={onAction} item={item} />)
    const dialog = await screen.findByRole('region', { name: 'Save as profile' })
    expect(within(dialog).getByText(/no longer active here/)).toBeTruthy()
    expect(within(dialog).getByLabelText('From install').value).toBe('')
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'x' } })
    expect(within(dialog).getByRole('button', { name: 'Save profile' }).disabled).toBe(true)
  })

  it('outside a git clone the Shipped destination is disabled', async () => {
    api.profiles.mockResolvedValue({ ...LIST, shippedWritable: false })
    render(<Profiles onAction={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save an install as profile…' }))
    expect(screen.getByRole('radio', { name: /Shipped/ }).disabled).toBe(true)
    expect(screen.getByText(/Disabled: this copy is not a git clone\./)).toBeTruthy()
  })

  it('reads a Save request only from its own shape', () => {
    expect(saveRequestOf(undefined)).toBeNull()
    expect(saveRequestOf('not json')).toBeNull()
    expect(saveRequestOf('{"save":{"host":"claude"}}')).toBeNull()
    expect(saveRequestOf('{"save":{"host":"claude","path":"C:/x"}}')).toEqual({
      host: 'claude',
      path: 'C:/x',
    })
  })
})
