import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import LevelBanner from '../components/LevelBanner.jsx'
import { ViewLevelProvider, useViewLevel } from '../hooks/useViewLevel.jsx'
import { resolveRoute } from '../lib/router.js'

const KEY = 'geneseed-view-level'

function Probe() {
  const { level, setLevel } = useViewLevel()
  return (
    <div>
      <span data-testid="level">{level}</span>
      <button onClick={() => setLevel('essentials')}>drop</button>
    </div>
  )
}

const mount = (hash) =>
  render(
    <ViewLevelProvider>
      <LevelBanner route={resolveRoute(hash)} />
      <Probe />
    </ViewLevelProvider>,
  )

describe('LevelBanner', () => {
  beforeEach(() => localStorage.setItem(KEY, 'essentials'))
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it.each(['#/item/wiki/foo', '#/section/config', '#/personal/notebook', '#/loops'])(
    'at Essentials, %s shows the Power banner',
    (hash) => {
      mount(hash)
      expect(screen.getByRole('status').textContent).toContain('This is a Power view.')
      expect(screen.getByRole('button', { name: 'Show Power views always' })).toBeTruthy()
    },
  )

  it('names Standard for #/kits', () => {
    mount('#/kits')
    expect(screen.getByRole('status').textContent).toContain('This is a Standard view.')
  })

  it('shows nothing on #/library', () => {
    mount('#/library')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('the button raises the level to the required one and the banner goes', () => {
    mount('#/loops')
    fireEvent.click(screen.getByRole('button', { name: 'Show Power views always' }))
    expect(screen.getByTestId('level').textContent).toBe('power')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('lowering the level keeps the page and shows the banner', () => {
    localStorage.setItem(KEY, 'power')
    const route = resolveRoute('#/loops')
    const snapshot = JSON.stringify(route)
    render(
      <ViewLevelProvider>
        <LevelBanner route={route} />
        <Probe />
      </ViewLevelProvider>,
    )
    expect(screen.queryByRole('status')).toBeNull()
    act(() => fireEvent.click(screen.getByText('drop')))
    expect(screen.getByRole('status').textContent).toContain('This is a Power view.')
    expect(JSON.stringify(route)).toBe(snapshot)
  })
})
