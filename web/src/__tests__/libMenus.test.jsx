import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import LibMenus from '../components/LibMenus.jsx'

// The stacked Library's two menus (styles.css shows them only under the `lib` container tier,
// where the rail is hidden): Section ▾, a menu of links to each section with its count, and
// Category ▾, a menu of toggles over the list, absent when the section has one group or none
// (as RailCats). Each trigger is a button saying its current value; a menu closes on a pick,
// on Escape and on a click outside, and gives focus back to its trigger.
const SECTIONS = [
  { key: 'skills', label: 'Skills', n: 80, href: '#/section/skills', on: true },
  { key: 'agents', label: 'Agents', n: 21, href: '#/section/agents', on: false },
  { key: 'wiki', label: 'Wiki', n: 1, href: '#/section/wiki', on: false },
]
const CATS = [
  { key: 'design', label: 'Design', n: 12, c: 'red' },
  { key: 'build', label: 'Build', n: 16, c: 'blue' },
]
const trigger = (name) => screen.getByRole('button', { name: new RegExp(`^${name}`) })

describe('LibMenus', () => {
  it('says the current section and category on their triggers, both closed', () => {
    render(<LibMenus sections={SECTIONS} cats={CATS} cat="build" total={80} onCat={() => {}} />)
    expect(trigger('Section').textContent).toMatch(/Section\s*Skills\s*80/)
    expect(trigger('Category').textContent).toMatch(/Category\s*Build\s*16/)
    for (const b of [trigger('Section'), trigger('Category')])
      expect(b.getAttribute('aria-expanded')).toBe('false')
  })

  it('has no Category menu for a section with one group or none', () => {
    render(<LibMenus sections={SECTIONS} cats={CATS.slice(0, 1)} cat="all" total={1} />)
    expect(screen.queryByRole('button', { name: /^Category/ })).toBeNull()
  })

  it('opens the sections as links in order, the current one marked, and closes on a pick', () => {
    render(<LibMenus sections={SECTIONS} cats={[]} cat="all" total={80} />)
    fireEvent.click(trigger('Section'))
    expect(trigger('Section').getAttribute('aria-expanded')).toBe('true')
    const menu = document.getElementById(trigger('Section').getAttribute('aria-controls'))
    const links = [...menu.querySelectorAll('a')]
    expect(links.map((a) => a.textContent)).toEqual(['Skills80', 'Agents21', 'Wiki1'])
    expect(links.map((a) => a.getAttribute('href'))).toEqual(SECTIONS.map((s) => s.href))
    expect(links[0].getAttribute('aria-current')).toBe('page')
    // Focus moves into the menu; the arrow keys walk it.
    expect(document.activeElement).toBe(links[0])
    fireEvent.keyDown(links[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(links[1])
    fireEvent.keyDown(links[1], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(links[0])
    fireEvent.click(links[1])
    expect(trigger('Section').getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger('Section'))
  })

  it('picks a category, All first with the total, and says it on the trigger', () => {
    const onCat = vi.fn()
    render(<LibMenus sections={SECTIONS} cats={CATS} cat="all" total={80} onCat={onCat} />)
    expect(trigger('Category').textContent).toMatch(/All\s*80/)
    fireEvent.click(trigger('Category'))
    const menu = document.getElementById(trigger('Category').getAttribute('aria-controls'))
    const opts = [...menu.querySelectorAll('button')]
    expect(opts.map((b) => b.textContent)).toEqual(['All80', 'Design12', 'Build16'])
    expect(opts.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
    fireEvent.click(opts[2])
    expect(onCat).toHaveBeenCalledWith('build')
    expect(trigger('Category').getAttribute('aria-expanded')).toBe('false')
  })

  // Review F6: the triggers say what they open; a menu opens on its current option; Tab out of
  // it closes it; `aria-controls` names the menu only while it exists.
  it('opens on the current option, names its popup, and closes when focus leaves it', () => {
    const onAgents = SECTIONS.map((s) => ({ ...s, on: s.key === 'agents' }))
    render(<LibMenus sections={onAgents} cats={[]} cat="all" total={80} />)
    expect(trigger('Section').getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger('Section').hasAttribute('aria-controls')).toBe(false)
    fireEvent.click(trigger('Section'))
    const menu = document.getElementById(trigger('Section').getAttribute('aria-controls'))
    expect(menu).not.toBeNull()
    expect(document.activeElement.textContent).toBe('Agents21')
    fireEvent.focusOut(document.activeElement, { relatedTarget: document.body })
    expect(trigger('Section').getAttribute('aria-expanded')).toBe('false')
    expect(trigger('Section').hasAttribute('aria-controls')).toBe(false)
  })

  it('closes on Escape and on a click outside, focus back on the trigger', () => {
    render(<LibMenus sections={SECTIONS} cats={[]} cat="all" total={80} />)
    fireEvent.click(trigger('Section'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger('Section').getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger('Section'))
    fireEvent.click(trigger('Section'))
    fireEvent.mouseDown(document.body)
    expect(trigger('Section').getAttribute('aria-expanded')).toBe('false')
  })
})
