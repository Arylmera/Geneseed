import React, { useRef, useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import Popover from '../components/Popover.jsx'

function Harness({ empty = false }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef(null)
  return (
    <div>
      <button ref={anchor} onClick={() => setOpen((o) => !o)}>
        Appearance
      </button>
      <button>elsewhere</button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} label="Appearance">
        {empty ? <p>nothing to press</p> : <button onClick={() => setOpen(false)}>Dark</button>}
      </Popover>
    </div>
  )
}

const trigger = () => screen.getByRole('button', { name: 'Appearance' })

// The keyboard half the topbar popovers lacked: focus in on open, Escape out, focus back.
describe('Popover', () => {
  it('opens as a labelled dialog and moves focus to its first control', () => {
    render(<Harness />)
    fireEvent.click(trigger())
    expect(screen.getByRole('dialog', { name: 'Appearance' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dark' }))
  })

  it('with nothing focusable inside, focuses the box itself', () => {
    render(<Harness empty />)
    fireEvent.click(trigger())
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
  })

  it('Escape closes it and focus returns to the trigger', () => {
    render(<Harness />)
    fireEvent.click(trigger())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('choosing an item that closes it also returns focus to the trigger', () => {
    render(<Harness />)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('a mousedown outside closes it; one on the trigger or inside does not', () => {
    render(<Harness />)
    fireEvent.click(trigger())
    fireEvent.mouseDown(trigger())
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Dark' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'elsewhere' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
