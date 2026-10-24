import React from 'react'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ConfirmProvider, useConfirm } from '../hooks/useConfirm.jsx'

// The provider's one job: turn a question into a promise that the themed dialog settles.
// A page awaits `confirm(msg, opts)`; Confirm resolves it true, Cancel (or Esc, which
// closes the dialog) resolves it false.
function Asker({ onAnswer, msg = 'Retire rule R3?', opts }) {
  const confirm = useConfirm()
  return <button onClick={async () => onAnswer(await confirm(msg, opts))}>ask</button>
}

const setup = (props) => {
  const answers = []
  render(
    <ConfirmProvider>
      <Asker onAnswer={(v) => answers.push(v)} {...props} />
    </ConfirmProvider>,
  )
  return answers
}

describe('useConfirm', () => {
  it('shows the question with its title and label, and resolves true on confirm', async () => {
    const answers = setup({ opts: { title: 'Retire this rule?', confirmLabel: 'Retire' } })
    fireEvent.click(screen.getByText('ask'))
    expect(screen.getByText('Retire rule R3?')).toBeTruthy()
    expect(screen.getByText('Retire this rule?')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByText('Retire')))
    expect(answers).toEqual([true])
  })

  it('resolves false on cancel', async () => {
    const answers = setup()
    fireEvent.click(screen.getByText('ask'))
    await act(async () => fireEvent.click(screen.getByText('Cancel')))
    expect(answers).toEqual([false])
  })

  it('falls back to a generic title and label when none is given', () => {
    setup()
    fireEvent.click(screen.getByText('ask'))
    expect(screen.getByText('Are you sure?')).toBeTruthy()
    expect(screen.getByText('Confirm')).toBeTruthy()
  })

  it('a second question answers the unanswered first one with false', async () => {
    const answers = setup()
    fireEvent.click(screen.getByText('ask'))
    fireEvent.click(screen.getByText('ask'))
    await act(async () => fireEvent.click(screen.getByText('Confirm')))
    expect(answers).toEqual([false, true])
  })

  // SH-8: on a destructive question the default (Enter) must be the safe way out, so the
  // danger tone puts focus on Cancel and paints Confirm as a danger button.
  it('a danger question focuses Cancel and marks Confirm as danger', () => {
    setup({ opts: { title: 'Stop the server?', confirmLabel: 'Stop server', tone: 'danger' } })
    fireEvent.click(screen.getByText('ask'))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Stop server' }).className).toBe('btn danger')
  })

  it('a plain question still focuses Confirm, painted as the plain button', () => {
    setup()
    fireEvent.click(screen.getByText('ask'))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.getByRole('button', { name: 'Confirm' }).className).toBe('btn')
  })

  it('a danger question that supersedes an open plain one moves focus to Cancel', () => {
    function Two() {
      const confirm = useConfirm()
      return (
        <>
          <button onClick={() => confirm('plain?')}>plain</button>
          <button onClick={() => confirm('wipe?', { tone: 'danger' })}>danger</button>
        </>
      )
    }
    render(
      <ConfirmProvider>
        <Two />
      </ConfirmProvider>,
    )
    fireEvent.click(screen.getByText('plain'))
    fireEvent.click(screen.getByText('danger'))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  })

  it('names the dialog by its title and describes it by its question', () => {
    setup({ opts: { title: 'Restore from source?' } })
    fireEvent.click(screen.getByText('ask'))
    const dialog = screen.getByRole('dialog', { name: 'Restore from source?' })
    const body = document.getElementById(dialog.getAttribute('aria-describedby'))
    expect(body?.textContent).toBe('Retire rule R3?')
  })

  it('throws a named error when asked outside a provider', () => {
    const thrown = []
    function Orphan() {
      const confirm = useConfirm()
      const ask = () => {
        try {
          confirm('x')
        } catch (e) {
          thrown.push(e.message)
        }
      }
      return <button onClick={ask}>orphan</button>
    }
    render(<Orphan />)
    fireEvent.click(screen.getByText('orphan'))
    expect(thrown).toEqual(['useConfirm() needs a <ConfirmProvider> above it'])
  })
})
