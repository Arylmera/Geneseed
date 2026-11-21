import React from 'react'
import { act, render, renderHook, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

import { useSkillStaging } from '../hooks/useSkillStaging.js'
import { ShipsTo } from '../components/SkillShips.jsx'

// The Library's install chips. Two installs, `a` and `b`. `bruno` ships to `a` and is excluded on
// `b`; `adhd` ships to both; `council` is kit-off on `b`. The rules under test:
//  - a click stages the install's WHOLE excluded set, and Apply sends exactly that set, sorted;
//  - switching a skill back on sends the set without it (`[]` re-admits everything);
//  - changes on several skills of one install stack into ONE Apply for that install;
//  - a chip that is kit-off, absent, locked or not a Geneseed skill does not switch.
const A = 'opencode:global:/a'
const B = 'claude:global:/b'
const items = [
  { name: 'bruno', ships: { [A]: 'on', [B]: 'excluded' }, toggle: true, locked: false },
  { name: 'adhd', ships: { [A]: 'on', [B]: 'on' }, toggle: true, locked: false },
  { name: 'council', kit: 'council', ships: { [A]: 'on', [B]: 'kit-off' }, toggle: true, locked: false },
  { name: 'develop', ships: { [A]: 'on', [B]: 'on' }, toggle: false, locked: true },
]
const keys = [A, B]
const install = (k) => ({ host: k.split(':')[0], path: k.split(':').slice(2).join(':') })
const setup = (data = items) => {
  const onAction = vi.fn(async () => 'job-1')
  const hook = renderHook(({ d }) => useSkillStaging(d, keys, onAction), { initialProps: { d: data } })
  return { ...hook, onAction }
}

describe('useSkillStaging', () => {
  it('stacks changes per install and applies the whole excluded set, sorted', async () => {
    const { result, onAction } = setup()
    act(() => result.current.toggle(B, 'adhd'))
    act(() => result.current.toggle(B, 'bruno'))
    expect(result.current.change(B)).toEqual({ off: ['adhd'], on: ['bruno'] })
    expect(result.current.staged).toEqual([B])
    expect(result.current.stateOf(items[0], B)).toBe('turning-on')
    expect(result.current.stateOf(items[1], B)).toBe('turning-off')
    await act(() => result.current.apply(B, install(B)))
    expect(onAction).toHaveBeenCalledWith('install', { host: 'claude', path: '/b', excludeSkills: ['adhd'] })
  })

  it('re-admitting the only excluded skill sends an empty set', async () => {
    const { result, onAction } = setup()
    act(() => result.current.toggle(B, 'bruno'))
    await act(() => result.current.apply(B, install(B)))
    expect(onAction).toHaveBeenCalledWith('install', { host: 'claude', path: '/b', excludeSkills: [] })
  })

  it('a toggle back to the deployed set is no staging at all', () => {
    const { result } = setup()
    act(() => result.current.toggle(A, 'adhd'))
    act(() => result.current.toggle(A, 'adhd'))
    expect(result.current.staged).toEqual([])
  })

  it('drops staging once the install excluded set changed under it', () => {
    const { result, rerender } = setup()
    act(() => result.current.toggle(A, 'adhd'))
    const moved = items.map((it) => (it.name === 'bruno' ? { ...it, ships: { [A]: 'excluded', [B]: 'excluded' } } : it))
    rerender({ d: moved })
    expect(result.current.change(A)).toEqual({ off: [], on: [] })
  })
})

describe('ShipsTo', () => {
  const Harness = ({ row }) => {
    const stage = useSkillStaging(items, keys, vi.fn())
    return <ShipsTo row={row} keys={keys} tagOf={(k) => k.split(':')[0]} stage={stage} busy={false} />
  }
  // A chip that cannot switch is a label, not a (disabled) button: its title — the why — must
  // stay readable on hover, which a disabled button does not give in most browsers.
  it('switches only an on or excluded chip of a switchable skill', () => {
    const { unmount } = render(<Harness row={items[2]} />)
    expect(screen.getByRole('button', { name: /council in opencode/ }).disabled).toBe(false)
    expect(screen.queryByRole('button', { name: /council in claude/ })).toBeNull()
    expect(screen.getByTitle(/council kit, which is off in claude/).textContent).toBe('claudekit off')
    unmount()
    render(<Harness row={items[3]} />)
    // A protected skill reads "always on" behind a padlock, never as a plain on chip.
    expect(screen.queryAllByRole('button')).toEqual([])
    const locked = screen.getAllByTitle(/links to develop by path/)
    expect(locked).toHaveLength(2)
    for (const c of locked) {
      expect(c.textContent).toMatch(/always on$/)
      expect(c.querySelector('.ship-lock')).not.toBeNull()
    }
  })

  // Agents: the same row, read-only. A core agent is "always on" behind a padlock; a kit agent
  // ships with its kit or says the kit is off; nothing is a button.
  it('renders an agent row read-only', () => {
    const core = { name: 'reviewer', kit: null, ships: { [A]: 'on', [B]: 'on' }, toggle: false, locked: true }
    const { unmount } = render(<ShipsTo row={core} keys={keys} tagOf={(k) => k.split(':')[0]} kind="agent" />)
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(screen.getAllByTitle('reviewer is a core agent: it ships with every install')).toHaveLength(2)
    unmount()
    const seat = { name: 'advocate', kit: 'council', ships: { [A]: 'on', [B]: 'kit-off' }, toggle: false, locked: false }
    render(<ShipsTo row={seat} keys={keys} tagOf={(k) => k.split(':')[0]} kind="agent" />)
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(screen.getByTitle('Ships to opencode with the council kit').textContent).toBe('opencode')
    expect(screen.getByTitle(/council kit, which is off in claude/).textContent).toBe('claudekit off')
  })

  it('a click marks the chip as staged', () => {
    render(<Harness row={items[0]} />)
    fireEvent.click(screen.getByRole('button', { name: /bruno in claude: excluded/ }))
    expect(screen.getByRole('button', { name: /bruno in claude: comes back/ }).getAttribute('aria-pressed')).toBe('true')
  })
})
