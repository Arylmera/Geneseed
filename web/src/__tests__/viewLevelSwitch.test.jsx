import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/index.js', () => ({ api: {} }))

import AppearancePopover from '../components/AppearancePopover.jsx'
import Settings from '../pages/Settings/index.jsx'
import { ViewLevelProvider } from '../hooks/useViewLevel.jsx'

const popover = () => (
  <AppearancePopover
    flavour="forge"
    onFlavour={() => {}}
    accentMode="flavour"
    onAccentMode={() => {}}
    onClose={() => {}}
    anchorRef={{ current: null }}
  />
)

const levelButtons = (root) =>
  ['Essentials', 'Standard', 'Power'].map((n) => within(root).getByRole('button', { name: n }))

describe('the view-level switch', () => {
  beforeEach(() => localStorage.clear())

  it('the popover offers the three levels, Essentials pressed by default', () => {
    render(<ViewLevelProvider>{popover()}</ViewLevelProvider>)
    const group = screen.getByRole('group', { name: 'View' })
    const [ess, std, pow] = levelButtons(group)
    expect(ess.getAttribute('aria-pressed')).toBe('true')
    expect(std.getAttribute('aria-pressed')).toBe('false')
    expect(pow.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('Hidden parts keep working.')).toBeTruthy()
  })

  it('the Settings switch has an accessible name', () => {
    render(
      <ViewLevelProvider>
        <Settings onAction={() => {}} />
      </ViewLevelProvider>,
    )
    expect(levelButtons(screen.getByRole('group', { name: 'View level' }))).toHaveLength(3)
  })

  it('clicking Power in the popover shows Power pressed in the Settings row', () => {
    render(
      <ViewLevelProvider>
        {popover()}
        <Settings onAction={() => {}} />
      </ViewLevelProvider>,
    )
    const row = screen.getByText('View level').closest('.sheet-row')
    expect(levelButtons(row)[0].getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('group', { name: 'View' }).querySelectorAll('button')[2])
    const [ess, , pow] = levelButtons(row)
    expect(pow.getAttribute('aria-pressed')).toBe('true')
    expect(ess.getAttribute('aria-pressed')).toBe('false')
    expect(row.textContent).toContain('How much of the console to show. Hidden parts keep working.')
  })
})
