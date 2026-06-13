import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../api/index.js', () => ({
  api: {
    themes: () =>
      Promise.resolve({
        themes: [
          { name: 'neutral', accent: 'cyan', blurb: 'plain' },
          { name: 'imperial', accent: 'yellow', blurb: '40k' },
        ],
        emits: [
          { name: 'opencode-global', desc: 'global' },
          { name: 'files', desc: 'dir' },
        ],
        current: { theme: 'neutral', emit: 'opencode-global' },
      }),
  },
}))

import Onboarding from '../pages/Dashboard/Onboarding.jsx'

describe('Onboarding', () => {
  it('renders the voice + mode pickers and deploys via the build action', async () => {
    const onAction = vi.fn()
    render(<Onboarding onAction={onAction} />)
    await waitFor(() => expect(screen.getByText('Deploy harness')).toBeTruthy())
    expect(screen.getByText('neutral')).toBeTruthy()
    expect(screen.getByText('imperial')).toBeTruthy()
    fireEvent.click(screen.getByText('Deploy harness'))
    expect(onAction).toHaveBeenCalledWith('build', { theme: 'neutral', emit: 'opencode-global' })
  })

  it('lets you pick a different voice before deploying', async () => {
    const onAction = vi.fn()
    render(<Onboarding onAction={onAction} />)
    await waitFor(() => expect(screen.getByText('imperial')).toBeTruthy())
    fireEvent.click(screen.getByText('imperial'))
    fireEvent.click(screen.getByText('Deploy harness'))
    expect(onAction).toHaveBeenCalledWith('build', { theme: 'imperial', emit: 'opencode-global' })
  })
})
