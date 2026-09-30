import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import {
  ACCENT_MODES,
  CUSTOM_ACCENTS,
  resolveAccentMode,
  customAccentName,
  pickedHex,
  accentTagline,
} from '../hooks/useAccentMode.js'
import { hexAccent, contrast } from '../lib/accents.js'
import AccentPicker from '../components/AccentPicker.jsx'

// The accent is Curated (the skin's own colour, the default), one of five fixed colours
// taken from the voice palette, or any colour from the picker. Auto (follow the voice)
// was dropped: it only ever showed a colour the fixed picks already offer.
describe('accent modes', () => {
  it('offers Curated, then five fixed colours from the voice palette', () => {
    expect(ACCENT_MODES.map((m) => m.id)).toEqual(['curated'])
    expect(CUSTOM_ACCENTS.map((c) => [c.id, c.short, c.hex])).toEqual([
      ['custom:cyan', 'Cyan', '#3AD4C4'],
      ['custom:blue', 'Blue', '#5B8CFF'],
      ['custom:magenta', 'Violet', '#C77DFF'],
      ['custom:yellow', 'Amber', '#E8B53D'],
      ['custom:green', 'Green', '#4ED888'],
    ])
  })

  // A stored 'auto' (the dropped mode, and the old default most browsers hold) reads as
  // Curated, as does anything unknown or a malformed picker value.
  it('keeps a known stored mode and reads anything else as curated', () => {
    for (const v of ['curated', 'custom:blue', 'hex:#1A2B8C']) expect(resolveAccentMode(v)).toBe(v)
    for (const v of ['auto', 'custom:red', 'hex:#12', 'hex:blue', 'bogus', null, undefined])
      expect(resolveAccentMode(v)).toBe('curated')
  })

  it('reads the palette name or the picked colour back out of a mode', () => {
    expect(customAccentName('custom:magenta')).toBe('magenta')
    expect(customAccentName('curated')).toBeNull()
    expect(pickedHex('hex:#1a2b8c')).toBe('#1A2B8C')
    expect(pickedHex('custom:blue')).toBeNull()
    expect(accentTagline('custom:yellow')).toBe('Always amber, whatever the voice or skin.')
    expect(accentTagline('hex:#1A2B8C')).toBe('Your own colour, #1A2B8C.')
  })
})

// A picked colour gets its companions derived to the same contract the fixed palette was
// hand-tuned to: the fill at 3:1 against the page, accent text at 4.5:1, readable ink on
// the fill. The pages are the card surfaces, #101317 dark and #F4F6F8 light.
describe('a picked colour', () => {
  const DARK = '#101317'
  const LIGHT = '#F4F6F8'

  it('keeps a colour that already reads, as it is', () => {
    expect(hexAccent('#3AD4C4', 'dark').accent).toBe('#3AD4C4')
  })

  it('lightens a navy too dark for the dark page, darkens a yellow too pale for the light one', () => {
    const d = hexAccent('#1A2B8C', 'dark')
    expect(contrast(d.accent, DARK)).toBeGreaterThanOrEqual(3)
    expect(contrast(d.text, DARK)).toBeGreaterThanOrEqual(4.5)
    const l = hexAccent('#FFF176', 'light')
    expect(contrast(l.accent, LIGHT)).toBeGreaterThanOrEqual(3)
    expect(contrast(l.text, LIGHT)).toBeGreaterThanOrEqual(4.5)
  })

  it('writes near-black ink on a pale fill and white ink on a deep one', () => {
    expect(hexAccent('#FFF176', 'dark').ink).toBe('#06100D')
    expect(hexAccent('#1A2B8C', 'light').ink).toBe('#FFFFFF')
  })
})

describe('AccentPicker', () => {
  it('picks Curated, a swatch, or any colour, and marks the current one', () => {
    const onChange = vi.fn()
    render(<AccentPicker value="custom:blue" onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Blue accent' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(screen.getByRole('button', { name: 'Curated' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
    expect(screen.queryByRole('button', { name: 'Auto' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Violet accent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Curated' }))
    fireEvent.input(screen.getByLabelText('Custom accent colour'), {
      target: { value: '#1a2b8c' },
    })
    expect(onChange.mock.calls).toEqual([['custom:magenta'], ['curated'], ['hex:#1A2B8C']])
  })

  it('shows the picked colour on the last swatch', () => {
    render(<AccentPicker value="hex:#1A2B8C" onChange={() => {}} />)
    const input = screen.getByLabelText('Custom accent colour')
    expect(input.value).toBe('#1a2b8c')
    expect(input.closest('label').classList.contains('picked')).toBe(true)
  })
})
