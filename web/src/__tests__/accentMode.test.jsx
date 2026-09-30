import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import {
  CUSTOM_ACCENTS,
  resolveAccentMode,
  customAccentName,
  accentTagline,
} from '../hooks/useAccentMode.js'
import AccentPicker from '../components/AccentPicker.jsx'

// Beside Auto (the voice's accent) and Curated (the skin's own), five fixed colours taken
// from the voice palette, so each already has its light companion and light-mode text
// colour. Red is left out (it reads as an error), white has no usable light value.
describe('accent modes', () => {
  it('offers five fixed colours from the voice palette', () => {
    expect(CUSTOM_ACCENTS.map((c) => [c.id, c.short, c.hex])).toEqual([
      ['custom:cyan', 'Cyan', '#3AD4C4'],
      ['custom:blue', 'Blue', '#5B8CFF'],
      ['custom:magenta', 'Violet', '#C77DFF'],
      ['custom:yellow', 'Amber', '#E8B53D'],
      ['custom:green', 'Green', '#4ED888'],
    ])
  })

  it('keeps a known stored mode and reads anything else as auto', () => {
    for (const v of ['auto', 'curated', 'custom:blue']) expect(resolveAccentMode(v)).toBe(v)
    for (const v of ['custom:red', 'custom:white', 'bogus', null, undefined])
      expect(resolveAccentMode(v)).toBe('auto')
  })

  it('names the palette colour a custom mode applies, and nothing for the sources', () => {
    expect(customAccentName('custom:magenta')).toBe('magenta')
    expect(customAccentName('auto')).toBeNull()
    expect(customAccentName('curated')).toBeNull()
    expect(accentTagline('custom:yellow')).toBe('Always amber, whatever the voice or skin.')
  })

  it('picks a source or a swatch, and marks the current one', () => {
    const onChange = vi.fn()
    render(<AccentPicker value="custom:blue" onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Blue accent' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(screen.getByRole('button', { name: 'Auto' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Violet accent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Curated' }))
    expect(onChange.mock.calls).toEqual([['custom:magenta'], ['curated']])
  })
})
