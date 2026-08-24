import React, { useEffect, useRef, useState } from 'react'
import { go } from '../lib/router.js'
import { useSearchIndex } from '../hooks/useSearchIndex.js'
import { Icon } from './Icon.jsx'
import Spotlight, { filterAndRank } from './Spotlight.jsx'

// Topbar search. `/` focuses it from anywhere (except inside another input).
// When the user types, a Spotlight dropdown shows global matches across the
// Library catalog, MCP servers, Docs and Specs — the per-page filter on
// Section/Docs/Specs still runs in parallel for in-context narrowing.
export default function Search({ value, onChange }) {
  const ref = useRef(null)
  const wrapRef = useRef(null)
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(0)
  const { index, prime } = useSearchIndex()

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
      ref.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Close the spotlight when the user clicks anywhere outside its container.
  useEffect(() => {
    if (!focused) return
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setFocused(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [focused])

  const open = focused && !!value.trim()
  // HOISTED OUT OF THE KEY HANDLER, because the INPUT needs it too. `aria-activedescendant`
  // has to name a row that exists or name nothing at all, so the input has to know how many
  // there are — and the handler was already recomputing this on every keystroke.
  const results = open && index ? filterAndRank(index, value) : []
  const activeId = active < results.length ? `spot-opt-${active}` : undefined

  const onKeyDown = (e) => {
    if (!open) return
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
        go(hit.route)
        setFocused(false)
        ref.current?.blur()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (value) onChange('')
      else {
        setFocused(false)
        ref.current?.blur()
      }
    }
  }

  return (
    <div className="tb-search" ref={wrapRef}>
      <Icon name="search" className="mag glyph" />
      {/* ⚠ THE COMBOBOX WIRING, AND IT WAS MISSING ENTIRELY. The dropdown was already a
          correct `listbox` of `option`s with `aria-selected` — but nothing connected it to
          this input, so the two halves were orphaned: no announcement that results had
          appeared, and arrow keys moved a highlight that reported nothing. Focus never
          leaves the input in this pattern, so `aria-activedescendant` is the ONLY channel
          that can say which row is current; without it the selection is visual only.
          `aria-controls` is conditional because pointing at an id that is not in the
          document is its own defect. */}
      <input
        ref={ref}
        role="combobox"
        aria-label="Search the harness"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? 'spotlight-list' : undefined}
        aria-activedescendant={activeId}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setActive(0)
        }}
        onFocus={() => {
          setFocused(true)
          prime()
        }}
        onKeyDown={onKeyDown}
        placeholder="Search the harness…"
        title="Press / to jump here, or Ctrl-K / ⌘K from inside any field"
      />
      {/* The badge still shows `/`: it is the shorter binding and the one that fits. The
          chord is in the title above rather than a second badge — two keycaps in a topbar
          field is noise, and the chord is the one you reach for when `/` is being typed
          into something. */}
      <span className="kbd">/</span>
      {/* `aria-expanded` tells a screen reader a list appeared; it does not say whether
          anything is IN it. Typing narrows the results silently otherwise — the one thing a
          sighted user gets for free from watching the list shrink. Polite, so it queues
          behind whatever the row announcement is saying rather than interrupting it. */}
      <span className="sr-only" role="status" aria-live="polite">
        {!open ? '' : results.length ? `${results.length} results` : 'no matches'}
      </span>
      {open && (
        <Spotlight
          query={value}
          index={index}
          loading={!index}
          active={active}
          onActive={setActive}
          onClose={() => {
            setFocused(false)
            ref.current?.blur()
          }}
        />
      )}
    </div>
  )
}
