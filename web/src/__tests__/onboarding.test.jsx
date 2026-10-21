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
          { name: 'bob-global', desc: 'bob global' },
          { name: 'bob', desc: 'bob per-repo' },
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

  // A project mode has no home of its own: it used to go through Build with no folder, and the
  // generator's default ./Harness landed inside the Geneseed checkout (reported 2026-10). So it
  // asks for a folder, cannot deploy without one, and goes through `deploy` with the folder as
  // `path` and the mode as `host`. A global mode still builds. `files` is not offered.
  it('asks a project mode for a folder and deploys it there', async () => {
    const onAction = vi.fn()
    render(<Onboarding onAction={onAction} />)
    await waitFor(() => expect(screen.getByText('Deploy harness')).toBeTruthy())
    expect(screen.queryByRole('option', { name: /^files/ })).toBeNull()
    expect(screen.queryByLabelText('Project folder to install into')).toBeNull()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bob' } })
    const button = screen.getByText('Deploy harness').closest('button')
    expect(button.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Project folder to install into'), {
      target: { value: '/work/repo' },
    })
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(onAction).toHaveBeenCalledWith('deploy', {
      host: 'bob',
      path: '/work/repo',
      theme: 'neutral',
    })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bob-global' } })
    fireEvent.click(screen.getByText('Deploy harness'))
    expect(onAction).toHaveBeenLastCalledWith('build', { theme: 'neutral', emit: 'bob-global' })
  })
})
