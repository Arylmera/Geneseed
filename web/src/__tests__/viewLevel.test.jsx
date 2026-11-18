import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ViewLevelProvider, useViewLevel } from '../hooks/useViewLevel.jsx'

const KEY = 'geneseed-view-level'

function Probe({ id = 'probe' }) {
  const { level, setLevel, canSee, rank } = useViewLevel()
  return (
    <div>
      <span data-testid={id}>{level}</span>
      <span data-testid={`${id}-rank`}>{rank}</span>
      <span data-testid={`${id}-tab`}>{String(canSee('tab:installs/edits'))}</span>
      <button onClick={() => setLevel('power')}>{`${id}-power`}</button>
    </div>
  )
}

describe('useViewLevel', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('defaults to essentials', () => {
    render(
      <ViewLevelProvider>
        <Probe />
      </ViewLevelProvider>,
    )
    expect(screen.getByTestId('probe').textContent).toBe('essentials')
    expect(screen.getByTestId('probe-rank').textContent).toBe('1')
  })

  it('reads a stored level back', () => {
    localStorage.setItem(KEY, 'standard')
    render(
      <ViewLevelProvider>
        <Probe />
      </ViewLevelProvider>,
    )
    expect(screen.getByTestId('probe').textContent).toBe('standard')
    expect(screen.getByTestId('probe-rank').textContent).toBe('2')
  })

  it('falls back to essentials on an unknown stored value', () => {
    localStorage.setItem(KEY, 'junk')
    render(
      <ViewLevelProvider>
        <Probe />
      </ViewLevelProvider>,
    )
    expect(screen.getByTestId('probe').textContent).toBe('essentials')
  })

  it('keeps two consumers equal after one sets the level, and persists it', () => {
    render(
      <ViewLevelProvider>
        <Probe id="a" />
        <Probe id="b" />
      </ViewLevelProvider>,
    )
    act(() => screen.getByText('a-power').click())
    expect(screen.getByTestId('a').textContent).toBe('power')
    expect(screen.getByTestId('b').textContent).toBe('power')
    expect(localStorage.getItem(KEY)).toBe('power')
  })

  it('canSee follows the level', () => {
    render(
      <ViewLevelProvider>
        <Probe />
      </ViewLevelProvider>,
    )
    expect(screen.getByTestId('probe-tab').textContent).toBe('false')
    act(() => screen.getByText('probe-power').click())
    expect(screen.getByTestId('probe-tab').textContent).toBe('true')
  })

  it('mounts at essentials and still changes when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    render(
      <ViewLevelProvider>
        <Probe />
      </ViewLevelProvider>,
    )
    expect(screen.getByTestId('probe').textContent).toBe('essentials')
    act(() => screen.getByText('probe-power').click())
    expect(screen.getByTestId('probe').textContent).toBe('power')
  })

  it('reads power outside a provider', () => {
    render(<Probe />)
    expect(screen.getByTestId('probe').textContent).toBe('power')
    expect(screen.getByTestId('probe-rank').textContent).toBe('3')
  })
})
