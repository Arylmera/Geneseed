import React, { useEffect, useRef } from 'react'
import { accentHex } from '../lib/accents.js'

// The voice/theme switcher that drops from the rail foot. Closes on an outside
// click or Esc; picking a theme rebuilds the deployed harness in that voice. Each
// voice is a real button, so the list is reachable and pickable from the keyboard.
export default function VoicePopover({ themes, current, onPick, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    const k = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', k)
    return () => {
      document.removeEventListener('mousedown', h)
      document.removeEventListener('keydown', k)
    }
  }, [onClose])
  // Focus the first voice once, on open — not on every re-render, which would yank
  // focus back while the user tabs through the list.
  useEffect(() => {
    ref.current?.querySelector('button.pop-item')?.focus()
  }, [])
  return (
    <div className="pop" ref={ref} role="menu" aria-label="Switch voice">
      <div className="tick" style={{ padding: '4px 10px 8px' }}>
        Switch voice
      </div>
      {themes.map((t) => (
        <button
          type="button"
          role="menuitemradio"
          aria-checked={t.name === current}
          key={t.name}
          className={`pop-item ${t.name === current ? 'on' : ''}`}
          onClick={() => onPick(t.name)}
        >
          <span
            className="po"
            style={{ background: accentHex(t.accent), boxShadow: `0 0 8px ${accentHex(t.accent)}` }}
          />
          <span className="pn">{t.name}</span>
        </button>
      ))}
    </div>
  )
}
