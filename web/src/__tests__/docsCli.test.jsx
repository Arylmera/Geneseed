import React from 'react'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, onTestFinished } from 'vitest'
import CliPage from '../pages/Docs/CliPage.jsx'

// The CLI reference's Copy button (components/CopyButton.jsx): it copies the command its title
// names, says Copied with a check or Copy failed when the clipboard refuses, and leaves no
// timer behind when the page goes away mid-feedback.
const PAGE = { title: 'CLI', prog: 'geneseed', commands: [{ name: 'setup', help: 'Set up.' }] }

const clipboard = (writeText) => {
  const was = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  onTestFinished(() =>
    was ? Object.defineProperty(navigator, 'clipboard', was) : delete navigator.clipboard,
  )
}

describe('CliPage copy', () => {
  it('copies the command its title names, and says Copied with a check', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    clipboard(writeText)
    render(<CliPage page={PAGE} />)
    const btn = screen.getByTitle('Copy geneseed setup')
    await act(async () => fireEvent.click(btn))
    expect(writeText).toHaveBeenCalledWith('geneseed setup')
    expect(btn.textContent).toBe('Copied')
    expect(btn.querySelector('svg path').getAttribute('d')).toBe('M5 12.5l4.5 4.5L19 7')
  })

  // VS-27: a title is not a name; every button on the page announced as just "Copy".
  it('names each button by the command it copies', () => {
    render(<CliPage page={PAGE} />)
    expect(screen.getByRole('button', { name: 'Copy geneseed setup' })).toBeTruthy()
  })

  it('says Copy failed when the clipboard refuses', async () => {
    clipboard(vi.fn(() => Promise.reject(new Error('denied'))))
    render(<CliPage page={PAGE} />)
    const btn = screen.getByTitle('Copy geneseed setup')
    await act(async () => fireEvent.click(btn))
    expect(btn.textContent).toBe('Copy failed')
  })

  it('clears its feedback timer when unmounted', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    onTestFinished(() => vi.useRealTimers())
    clipboard(vi.fn(() => Promise.resolve()))
    const { unmount } = render(<CliPage page={PAGE} />)
    await act(async () => fireEvent.click(screen.getByTitle('Copy geneseed setup')))
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

// A verb's or an option's `description` (the long help) renders under its one-line help, a
// paragraph per blank-line block; an empty or absent one draws nothing.
describe('CliPage description', () => {
  const WITH = {
    title: 'CLI',
    prog: 'geneseed',
    commands: [
      {
        name: 'update',
        help: 'Pull and rebuild.',
        description: 'Pulls the checkout.\n\nThen rebuilds every active install.',
        options: [
          {
            names: ['--check'],
            help: 'Only look.',
            description: 'Asks origin without pulling.',
            is_flag: true,
          },
        ],
      },
      { name: 'setup', help: 'Set up.', description: '' },
    ],
  }

  it('draws each paragraph of a description, and nothing for an empty one', () => {
    const { container } = render(<CliPage page={WITH} />)
    const cards = container.querySelectorAll('.cli-card')
    expect(
      [...cards[0].querySelectorAll(':scope > .cli-desc p')].map((p) => p.textContent),
    ).toEqual(['Pulls the checkout.', 'Then rebuilds every active install.'])
    expect(cards[0].querySelector('.cli-arg .cli-desc').textContent).toBe(
      'Asks origin without pulling.',
    )
    expect(cards[1].querySelector('.cli-desc')).toBeNull()
  })

  it('draws no description for a table that has none', () => {
    const { container } = render(<CliPage page={PAGE} />)
    expect(container.querySelector('.cli-desc')).toBeNull()
  })
})
