import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../api.js', () => ({
  api: {
    themes: () => Promise.resolve({
      themes: [
        { name: 'neutral', blurb: 'plain', accent: 'cyan', tagline: '', sigil: '' },
        { name: 'imperial', blurb: 'for the Emperor', accent: 'yellow', tagline: '', sigil: '✠' },
      ],
      emits: [{ name: 'opencode-global', desc: '' }],
      current: { theme: 'neutral', emit: 'opencode-global' },
    }),
  },
}))

import Themes from '../pages/Themes.jsx'

describe('Themes', () => {
  it('renders a card per theme and marks the current one', async () => {
    render(<Themes onAction={() => {}} />)
    await waitFor(() => expect(screen.getByText('neutral')).toBeTruthy())
    expect(screen.getByText('imperial')).toBeTruthy()
    expect(screen.getByText('current')).toBeTruthy()   // badge on neutral
    expect(screen.getByText('Applied')).toBeTruthy()   // disabled current button
    expect(screen.getByText('Apply')).toBeTruthy()     // imperial is applicable
  })
})
