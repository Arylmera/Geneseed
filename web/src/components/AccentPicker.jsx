import React from 'react'
import Seg from './Seg.jsx'
import { ACCENT_MODES, CUSTOM_ACCENTS } from '../hooks/useAccentMode.js'

// The accent choice, shared by the Appearance popover and Installs / Server: the two
// sources (Auto, Curated) as a segmented control, then the fixed colours as swatches.
export default function AccentPicker({ value, onChange, labelledBy }) {
  return (
    <div className="accent-picker">
      <Seg aria-labelledby={labelledBy}>
        {ACCENT_MODES.map((m) => (
          <button
            type="button"
            key={m.id}
            className={value === m.id ? 'on' : ''}
            aria-pressed={value === m.id}
            title={m.tagline}
            onClick={() => onChange(m.id)}
          >
            {m.short}
          </button>
        ))}
      </Seg>
      <div className="accent-swatches" role="group" aria-label="Fixed accent colours">
        {CUSTOM_ACCENTS.map((c) => (
          <button
            type="button"
            key={c.id}
            className={`accent-swatch${value === c.id ? ' on' : ''}`}
            style={{ '--sw': c.hex }}
            aria-pressed={value === c.id}
            aria-label={`${c.short} accent`}
            title={c.short}
            onClick={() => onChange(c.id)}
          />
        ))}
      </div>
    </div>
  )
}
