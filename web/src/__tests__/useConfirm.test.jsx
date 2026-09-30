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
