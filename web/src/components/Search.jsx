import React, { useEffect, useMemo, useRef, useState } from 'react'
import { go } from '../lib/router.js'
import { useSearchIndex, PAGE_ENTRIES } from '../hooks/useSearchIndex.js'
import { useConfirm } from '../hooks/useConfirm.jsx'
import { Icon } from './Icon.jsx'
import Spotlight, { filterAndRank } from './Spotlight.jsx'

// The command palette. The topbar shows a button styled as a field; it, `/` and Ctrl-K
// open a modal dialog holding the combobox, whose listbox (Spotlight) lists the app's
// actions, every page, and global matches across the Library catalog, MCP servers and Docs.
//
// A button, not an input: focus returns to the trigger on close, and a field that opens the
// palette on focus would open it again the moment it got focus back.
//
// `actions` come from App, which owns the handlers: `{ kind: 'Actions', title, desc, hay,
// run, confirm? }`. The palette itself never writes; a row with `confirm` (`{ msg, title,
// confirmLabel, tone }`) asks through useConfirm before `run()` — "actions that write always
// ask first", and Enter on the top row is the easiest key in the app to press by accident.
export default function Search({ actions = [], dataRev }) {
  const dlgRef = useRef(null)
  const ref = useRef(null)
  const triggerRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const { index, error, prime } = useSearchIndex(dataRev)
  const confirm = useConfirm()

  const openPalette = () => {
    setOpen(true)
    prime()
  }

  // Imperative, not an effect on `open`: the dialog must be shut and focus back on the
  // trigger BEFORE an action runs, so the confirm it may open sits over the page. A modal
  // dialog makes the page inert, so the trigger cannot take focus until it is closed.
  const close = () => {
    const d = dlgRef.current
    if (d?.open) {
      // jsdom lacks showModal/close — the attribute fallbacks keep tests rendering.
      if (typeof d.close === 'function') d.close()
      else d.removeAttribute('open')
    }
    setOpen(false)
    setQuery('')
    setActive(0)
    triggerRef.current?.focus()
  }

  useEffect(() => {
    const d = dlgRef.current
    if (!open || !d || d.open) return
    if (typeof d.showModal === 'function') d.showModal()
    else d.setAttribute('open', '')
    // By hand, after the dialog is open: autoFocus fires at mount, while it is still closed.
    ref.current?.focus()
  }, [open])

  // Two bindings, and the second is not a duplicate of the first. `/` is the fast one and
  // costs nothing to press — but it is only available when no field has focus, which is
  // exactly why ⌘K/Ctrl-K exists beside it: the modifier chord is the one convention that
  // still works from inside a text box, which is where a user editing their rules or their
  // profile actually is when they want to jump somewhere else.
  useEffect(() => {
    const onKey = (e) => {
      const chord = (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k'
      if (!chord && (e.key !== '/' || e.target.closest('input, textarea, select'))) return
      e.preventDefault()
      setOpen(true)
      prime()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prime])

  // Actions and Pages need no fetch, so they head the list while the index loads and after
  // it fails; the fetched items join below them.
  const entries = useMemo(
    () => [...actions.map((a) => ({ sortKey: -2, ...a })), ...PAGE_ENTRIES, ...(index || [])],
    [actions, index],
  )
  // HOISTED OUT OF THE KEY HANDLER, because the INPUT needs it too. `aria-activedescendant`
  // has to name a row that exists or name nothing at all, so the input has to know how many
  // there are — and the handler was already recomputing this on every keystroke.
  const results = open ? filterAndRank(entries, query) : []
  const activeId = active < results.length ? `spot-opt-${active}` : undefined

  // Close first (see `close`), then act. A row with `run` is an action; any other row is
  // a place to go.
  const pick = async (hit) => {
    close()
    if (!hit.run) return go(hit.route)
    const c = hit.confirm
    if (
      c &&
      !(await confirm(c.msg, { title: c.title, confirmLabel: c.confirmLabel, tone: c.tone }))
    )
      return
    hit.run()
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, Math.max(results.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      const hit = results[active]
      if (hit) {
        e.preventDefault()
        pick(hit)
      }
    } else if (e.key === 'Escape') {
      // Cancelling the keydown also cancels the dialog's own Esc close, so a first Esc
      // only clears the query.
      e.preventDefault()
      if (query) {
        setQuery('')
        setActive(0)
      } else close()
    }
  }

  return (
    <>
      <button
        type="button"
        className="tb-cmdk"
        ref={triggerRef}
        aria-haspopup="dialog"
        onClick={openPalette}
        title="Press / to open, or Ctrl-K / ⌘K from inside any field"
      >
        <Icon name="search" className="mag glyph" />
        <span className="tb-cmdk-label">Search or run…</span>
        {/* The badge shows the chord, the binding that works from anywhere, including inside
            another field; `/` is in the title above. One keycap, not two: two in a topbar
            field is noise. */}
        <kbd className="tb-cmdk-key">Ctrl K</kbd>
      </button>
      {/* Native <dialog>, mounted always (showModal needs it in the document) and filled only
          while open. showModal gives the focus trap and ::backdrop; onCancel is a bare Esc
          that reached the dialog; a click whose target is the dialog itself landed on the
          backdrop, since the panel's children fill it edge to edge. */}
      <dialog
        ref={dlgRef}
        className="palette"
        aria-label="Search or run"
        onCancel={(e) => {
          e.preventDefault()
          close()
        }}
        onClose={() => open && close()}
        onClick={(e) => e.target === dlgRef.current && close()}
      >
        {open && (
          <>
            <div className="palette-head">
              <Icon name="search" className="mag glyph" />
              {/* ⚠ THE COMBOBOX WIRING, AND IT WAS MISSING ENTIRELY. The dropdown was already a
                  correct `listbox` of `option`s with `aria-selected` — but nothing connected it
                  to this input, so the two halves were orphaned: no announcement that results
                  had appeared, and arrow keys moved a highlight that reported nothing. Focus
                  never leaves the input in this pattern, so `aria-activedescendant` is the ONLY
                  channel that can say which row is current; without it the selection is visual
                  only. The listbox is always rendered while the palette is open (an empty query
                  lists actions and pages), so `aria-controls` always names a real id. */}
              <input
                ref={ref}
                role="combobox"
                aria-label="Search or run"
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls="spotlight-list"
                aria-activedescendant={activeId}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActive(0)
                }}
                onKeyDown={onKeyDown}
                placeholder="Search or run…"
              />
              <kbd className="palette-key">Esc</kbd>
            </div>
            {/* `aria-expanded` tells a screen reader a list appeared; it does not say whether
                anything is IN it. Typing narrows the results silently otherwise — the one thing
                a sighted user gets for free from watching the list shrink. Polite, so it queues
                behind whatever the row announcement is saying rather than interrupting it. */}
            <span className="sr-only" role="status" aria-live="polite">
              {results.length ? `${results.length} results` : 'no matches'}
            </span>
            <Spotlight
              query={query}
              index={entries}
              loading={!index}
              error={index ? '' : error}
              active={active}
              onActive={setActive}
              onPick={pick}
            />
            <div className="palette-foot">
              <span>↑↓ move</span>
              <span>↵ open</span>
              <span>actions that write always ask first</span>
            </div>
          </>
        )}
      </dialog>
    </>
  )
}
