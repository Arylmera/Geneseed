import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { LibList, GroupedRows } from '../components/LibRows.jsx'

const ROWS = [
  { name: 'a', title: 'A' },
  { name: 'b', title: 'B' },
  { name: 'c', title: 'C' },
]
const List = ({ activeName }) => (
  <LibList label="Skills" count={3} q="" onQ={() => {}} matched={3} inView={[activeName]}>
    <GroupedRows rows={ROWS} activeName={activeName} hrefOf={(it) => `#/x/${it.name}`} />
  </LibList>
)
const rows = () => [...document.querySelectorAll('.lib-row')]

// The list is ONE tab stop (a roving tabindex): Tab enters it on the open row and leaves it
// on the next control, instead of walking every row; the arrows, Home and End move inside.
describe('LibList keyboard', () => {
  it('makes the open row the only tab stop', () => {
    render(<List activeName="b" />)
    expect(rows().map((r) => r.tabIndex)).toEqual([-1, 0, -1])
  })

  it('without an open row, the first row is the tab stop', () => {
    render(<List activeName={null} />)
    expect(rows().map((r) => r.tabIndex)).toEqual([0, -1, -1])
  })

  it('the tab stop follows focus as the arrows walk', () => {
    render(<List activeName="b" />)
    rows()[1].focus()
    fireEvent.keyDown(rows()[1], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows()[2])
    expect(rows().map((r) => r.tabIndex)).toEqual([-1, -1, 0])
  })

  it('ArrowDown in the filter moves to the first row', () => {
    render(<List activeName="b" />)
    const filter = screen.getByRole('textbox', { name: 'Filter Skills' })
    filter.focus()
    fireEvent.keyDown(filter, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows()[0])
  })

  it('End goes to the last row, Home to the first', () => {
    render(<List activeName="b" />)
    rows()[1].focus()
    fireEvent.keyDown(rows()[1], { key: 'End' })
    expect(document.activeElement).toBe(rows()[2])
    fireEvent.keyDown(rows()[2], { key: 'Home' })
    expect(document.activeElement).toBe(rows()[0])
  })
})

// A click or Enter on a row changes the reader beside the list, which a screen reader does
// not see; the live region says which entry opened.
describe('LibList announcement', () => {
  it('stays silent on mount, then announces the newly opened row', () => {
    const { rerender } = render(<List activeName="b" />)
    // The selection a page opens on is not news.
    expect(screen.getByRole('status').textContent).toBe('')
    rerender(<List activeName="c" />)
    expect(screen.getByRole('status').textContent).toBe('C opened')
  })
})
