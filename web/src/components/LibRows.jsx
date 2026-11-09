import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import StatusBadge from './StatusBadge.jsx'
import FilterInput from './FilterInput.jsx'
import { motionOK } from '../lib/motion.js'

// The origin of a skill or agent a kit ships, on its row and in its reader.
export const KitBadge = ({ name }) => (
  <span className="tag acc" title={`Ships with the ${name} kit`}>
    kit: {name}
  </span>
)

// The primary agent's pill, styled as KitBadge: every agent inherits from it.
export const BaseBadge = () => (
  <span className="tag acc" title="Every agent inherits this agent's root file">
    base
  </span>
)

// The list pane, shared by the Library, the Loops page and the Docs (all three-pane: a rail
// of sections, this list, a reader): the pane itself (LibList), its rows, and the filter.

// The filter: a plain substring over title, name (what a link says) and description, any case.
export function filterRows(rows, q) {
  const ql = (q || '').trim().toLowerCase()
  if (!ql) return rows
  return rows.filter((r) =>
    `${r.title || ''} ${r.name || ''} ${r.desc || ''}`.toLowerCase().includes(ql),
  )
}

// The middle pane: a head naming the list with its count (`extra` beside it), the filter box,
// and the scroller holding the caller's rows (`children`), arrow-key walkable and keeping the
// active row in view (`inView` is what moves it: the section and the selection). `matched` is
// how many rows the filter left, so a filter that leaves none says so.
//
// The rows are ONE tab stop (a roving tabindex, `rove`): Tab enters on the focused row, else
// the open one, else the first, and the next Tab leaves the list. ArrowDown in the filter
// enters it. The open row is announced in a live region, since a click or Enter changes the
// reader beside the list, which a screen reader does not otherwise hear. `tools` sits under
// the filter (the Library's "Show" chips); the other lists pass none.
export function LibList({ label, count, extra, tools, q, onQ, matched, inView, children }) {
  const rowsRef = useActiveRowInView(inView)
  const listRef = useRef(null)
  useEntryInView(listRef, inView)
  // After every render: the caller owns the rows, so any render may add or drop them.
  useLayoutEffect(() => rove(rowsRef.current))
  const [said, setSaid] = useState('')
  const first = useRef(true)
  useEffect(() => {
    // The selection a page opens on is not news; only a change is.
    if (first.current) {
      first.current = false
      return
    }
    setSaid(rowsRef.current?.querySelector('.lib-row.on')?.dataset.title || '')
    // `inView` is the caller's trigger (the section and the selection).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, inView)
  const onKeyDown = (e) => {
    if (e.key !== 'ArrowDown' || !e.target.classList?.contains('lib-filter')) return
    e.preventDefault()
    rowsRef.current?.querySelector('.lib-row')?.focus()
  }
  return (
    <section className="lib-list" aria-label={label} onKeyDown={onKeyDown} ref={listRef}>
      <div className="lib-list-head">
        <b>
          {label} <span className="mono dim">{count}</span>
        </b>
        {extra}
      </div>
      <FilterInput
        value={q}
        onChange={onQ}
        placeholder={`Filter ${label.toLowerCase()}`}
        label={`Filter ${label}`}
      />
      {tools ? <div className="lib-tools">{tools}</div> : null}
      <div
        className="lib-rows"
        ref={rowsRef}
        onKeyDown={walkRows}
        onFocus={(e) => rove(e.currentTarget)}
      >
        {children}
        {q.trim() && matched === 0 && (
          <div className="empty" style={{ padding: 32 }}>
            <div className="big">No matches</div>
            Nothing in {label.toLowerCase()} matches “{q.trim()}”.
          </div>
        )}
      </div>
      {/* Outside the scroller: an absolute .sr-only inside it escapes the overflow and
          stretches the document. */}
      <p className="sr-only" role="status" aria-live="polite">
        {said ? `${said} opened` : ''}
      </p>
    </section>
  )
}

// One row in the list pane: a real link, so it opens in a new tab, reads as navigation to
// assistive tech, and arrow keys can walk the list (walkRows below). `children` are pills
// after the name (the Loops page's "human gate", "mutate").
export function LibRow({ item, isOpen, href, children }) {
  return (
    <a
      className={`lib-row${isOpen ? ' on' : ''}`}
      href={href}
      aria-current={isOpen ? 'true' : undefined}
      data-title={item.title || item.name}
      data-pinned={item.base ? 'true' : undefined}
    >
      <span className="lr-name">
        {item.title || item.name}
        <StatusBadge status={item.status} compact />
        {item.kit ? <KitBadge name={item.kit} /> : null}
        {item.base ? <BaseBadge /> : null}
        {children}
      </span>
      {item.desc ? <span className="lr-desc">{item.desc}</span> : null}
      {item.meta ? <span className="lr-meta mono">{item.meta}</span> : null}
    </a>
  )
}

// The rows, with a small header each time a row's `group` changes (a wiki page's vault, a
// skill's class, a loop template's category). Rows without groups render no headers.
// `pills(it)` adds a row's pills; the Library puts its usage count there.
export function GroupedRows({ rows, activeName, hrefOf, pills }) {
  let lastGroup = null
  const out = []
  for (const it of rows) {
    if (it.group && it.group !== lastGroup) {
      lastGroup = it.group
      out.push(
        <div className="lib-group" key={`g-${it.group}`}>
          {it.groupC ? (
            <span className="cdot" style={{ '--cc': it.groupC }} aria-hidden="true" />
          ) : null}
          {it.group}
        </div>,
      )
    }
    out.push(
      <LibRow key={it.name} item={it} isOpen={activeName === it.name} href={hrefOf(it)}>
        {pills?.(it)}
      </LibRow>,
    )
  }
  return out
}

// Arrow keys walk the list's links, Home and End jump to its ends; Enter follows the focused
// one. The rows' scroller's onKeyDown.
export function walkRows(e) {
  const rows = [...e.currentTarget.querySelectorAll('.lib-row')]
  const idx = rows.indexOf(document.activeElement)
  if (idx === -1) return
  const to = {
    ArrowDown: Math.min(idx + 1, rows.length - 1),
    ArrowUp: Math.max(idx - 1, 0),
    Home: 0,
    End: rows.length - 1,
  }[e.key]
  if (to === undefined) return
  e.preventDefault()
  rows[to].focus()
}

// The roving tab stop: the focused row, else the open one, else the first; every other row
// is tabIndex -1, so the list is one Tab stop and the arrows walk inside it.
function rove(box) {
  if (!box) return
  const rows = [...box.querySelectorAll('.lib-row')]
  const stop =
    rows.find((r) => r === document.activeElement) || box.querySelector('.lib-row.on') || rows[0]
  for (const r of rows) r.tabIndex = r === stop ? 0 : -1
}

// Keep the active row in view inside the list scroller, without scrollIntoView (which would
// also scroll the page), and only when it is genuinely off-screen: re-centering a row that was
// just clicked moves the list under the cursor. Returns the ref for the scroller.
export function useActiveRowInView(deps) {
  const box = useRef(null)
  useEffect(() => {
    const b = box.current
    const el = b?.querySelector('.lib-row.on')
    if (!el || !b) return
    const top = el.offsetTop
    if (top >= b.scrollTop && top + el.clientHeight <= b.scrollTop + b.clientHeight) return
    b.scrollTop = Math.max(0, top - b.clientHeight / 2 + el.clientHeight / 2)
    // `deps` is the caller's trigger (the section and the selection).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return box
}

// Where the panes stack (the `lib` container tier in styles.css) the entry sits under the list,
// so a row picked there would open off screen: bring the entry into view. Only a new selection
// in the same section counts — not the entry a page opens on, nor the first row a new section
// lights. "Stacked" is read from the layout (the reader starts at or below the list's bottom),
// so the side-by-side panes and the Docs (page above its list) never scroll.
function useEntryInView(listRef, [section, item]) {
  const was = useRef([section, item])
  useEffect(() => {
    const [s0, i0] = was.current
    was.current = [section, item]
    if (!item || section !== s0 || item === i0) return
    const list = listRef.current
    const reader = list?.parentElement?.querySelector(':scope > .lib-reader')
    if (!reader) return
    if (reader.getBoundingClientRect().top < list.getBoundingClientRect().bottom - 1) return
    reader.scrollIntoView?.({ behavior: motionOK() ? 'smooth' : 'auto', block: 'start' })
  }, [listRef, section, item])
}
