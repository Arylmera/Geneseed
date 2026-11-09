import React from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import DropMenu from '../components/DropMenu.jsx'

// A compact one-of-several picker: a trigger saying the current choice (no counts; the stacked
// toolbar's counts live on its section buttons), opening a menu of the choices on the house
// Popover. Escape and a click outside close it; a pick closes it; focus goes back to the trigger.
const OPTS = [
  { key: 'all', label: 'All uses' },
  { key: 'used', label: 'Used' },
  { key: 'unused', label: 'Not used yet' },
  { key: 'exp', label: 'Experimental' },
]
const trigger = () => screen.getByRole('button', { name: /^Show:/ })

describe('DropMenu', () => {
  it('says the current choice, names its popup, and opens on that choice', () => {
    render(<DropMenu label="Show" options={OPTS} value="used" onChange={() => {}} />)
    expect(trigger().getAttribute('aria-label')).toBe('Show: Used')
    expect(trigger().textContent).toMatch(/^Used/)
    expect(trigger().textContent).not.toMatch(/\d/)
    expect(trigger().getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(trigger().hasAttribute('aria-controls')).toBe(false)
    fireEvent.click(trigger())
    const menu = document.getElementById(trigger().getAttribute('aria-controls'))
    const opts = within(menu).getAllByRole('button')
    expect(opts.map((b) => b.textContent)).toEqual(OPTS.map((o) => o.label))
    expect(opts.map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ])
    expect(document.activeElement).toBe(opts[1])
    fireEvent.keyDown(opts[1], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(opts[2])
  })

  it('picks, closes, and gives focus back to the trigger', () => {
    const onChange = vi.fn()
    render(<DropMenu label="Show" options={OPTS} value="all" onChange={onChange} />)
    fireEvent.click(trigger())
    const menu = document.getElementById(trigger().getAttribute('aria-controls'))
    fireEvent.click(within(menu).getByRole('button', { name: 'Experimental' }))
    expect(onChange).toHaveBeenCalledWith('exp')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger())
  })

  it('closes on Escape and on a click outside', () => {
    render(<DropMenu label="Show" options={OPTS} value="all" onChange={() => {}} />)
    fireEvent.click(trigger())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger())
    fireEvent.click(trigger())
    fireEvent.mouseDown(document.body)
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
  })

  // On Safari and on Firefox for macOS a button takes no focus on mousedown, so focus moves to
  // the popover box before the click on an option lands: that is still inside the menu.
  it('keeps the menu while focus moves to its own box, so a mouse pick lands', () => {
    const onChange = vi.fn()
    render(<DropMenu label="Show" options={OPTS} value="all" onChange={onChange} />)
    fireEvent.click(trigger())
    const menu = document.getElementById(trigger().getAttribute('aria-controls'))
    fireEvent.focusOut(document.activeElement, { relatedTarget: menu.closest('.popover') })
    fireEvent.click(within(menu).getByRole('button', { name: 'Used' }))
    expect(onChange).toHaveBeenCalledWith('used')
  })
})
