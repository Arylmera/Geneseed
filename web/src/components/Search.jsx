import React, { useEffect, useRef } from 'react'
import { Icon } from './Icon.jsx'

// Topbar search. `/` focuses it from anywhere (except inside another input).
export default function Search({ value, onChange }) {
  const ref = useRef(null)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.target.closest('input, textarea, select')) return
      e.preventDefault()
      ref.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="tb-search">
      <Icon name="search" className="mag glyph" />
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search the harness…"
      />
      <span className="kbd">/</span>
    </div>
  )
}
