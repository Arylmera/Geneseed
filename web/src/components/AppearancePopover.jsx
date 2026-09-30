import React, { useEffect, useRef } from 'react'
import Seg from './Seg.jsx'
import { FLAVOURS } from '../hooks/useFlavour.js'
import { ACCENT_MODES } from '../hooks/useAccentMode.js'
import { LAYOUTS } from '../hooks/useLayout.js'

// The display choices, one click from any page: the skin, where the accent colour comes
// from, and which view the Overview opens on. All three are this browser's alone
// (localStorage) and apply live; nothing here rebuilds anything. Installs / Server keeps
// the long form with each skin's description.
export default function AppearancePopover({
  flavour,
  onFlavour,
  accentMode,
  onAccentMode,
  layout,
  onLayout,
  onClose,
}) {
  const ref = useRef(null)
  useEffect(() => {
    const down = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.('.tb-pop-anchor'))
        onClose()
    }
    const key = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [onClose])
  const group = (id, label, items, value, onPick) => (
    <div className="ap-group">
      <span className="ap-label" id={id}>
        {label}
      </span>
      <Seg aria-labelledby={id}>
        {items.map((it) => (
          <button
            type="button"
            key={it.id}
            className={value === it.id ? 'on' : ''}
            aria-pressed={value === it.id}
            title={it.tagline}
            onClick={() => onPick(it.id)}
          >
            {it.short}
          </button>
        ))}
      </Seg>
    </div>
  )
  return (
    <div className="appearance-pop" ref={ref} role="dialog" aria-label="Appearance">
      {group('ap-skin', 'Skin', FLAVOURS, flavour, onFlavour)}
      {group('ap-accent', 'Accent', ACCENT_MODES, accentMode, onAccentMode)}
      {group('ap-view', 'Overview view', LAYOUTS, layout, onLayout)}
    </div>
  )
}
