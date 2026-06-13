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

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.target.closest('input, textarea, select')) return
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

  const onKeyDown = (e) => {
    if (!open) return
    const results = filterAndRank(index, value)
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
      <input
        ref={ref}
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
      />
      <span className="kbd">/</span>
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
