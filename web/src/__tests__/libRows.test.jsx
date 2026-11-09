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

// The stacked list's fold (useFolds): `inView` is [section, entry]. A route naming an entry
// from outside the list folds it; a pick in the list keeps it open for the route change the
// pick causes, and only that one.
const Routed = ({ inView }) => (
  <LibList label="Skills" count={3} q="" onQ={() => {}} matched={3} inView={inView}>
    <GroupedRows rows={ROWS} activeName={inView[1]} hrefOf={(it) => `#/x/${it.name}`} />
  </LibList>
)
const open = () => document.querySelector('.lib-list').dataset.open

describe('LibList fold', () => {
  it('a click on the open row keeps nothing for a later jump from outside', () => {
    window.location.hash = '#/x'
    const { rerender } = render(<Routed inView={['x', undefined]} />)
    expect(open()).toBe('true')
    fireEvent.click(rows()[0])
    window.location.hash = '#/x/a'
    rerender(<Routed inView={['x', 'a']} />)
    expect(open()).toBe('true') // the pick's own route change keeps the list open
    // The open row again: its href is the route, so no route change follows.
    fireEvent.click(rows()[0])
    rerender(<Routed inView={['y', 'b']} />) // Ctrl-K into another section
    expect(open()).toBe('false')
  })

  // jsdom loads no styles.css, so a row inside `display: none` still takes focus here: this
  // pins the unfold, the half that fails without the fix.
  it('ArrowDown in the filter of a folded list unfolds it, then focuses the first row', () => {
    render(<Routed inView={['x', 'b']} />)
    expect(open()).toBe('false')
    const filter = screen.getByRole('textbox', { name: 'Filter Skills' })
    filter.focus()
    fireEvent.keyDown(filter, { key: 'ArrowDown' })
    expect(open()).toBe('true')
    expect(document.activeElement).toBe(rows()[0])
  })
})
