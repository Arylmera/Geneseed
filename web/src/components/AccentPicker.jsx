import React from 'react'
import { ACCENT_MODES, CUSTOM_ACCENTS, pickedHex } from '../hooks/useAccentMode.js'

// The accent choice, shared by the Appearance popover and Installs / Server: Curated (the
// skin's own colour), the five fixed colours as swatches, and last a colour picker whose
// swatch shows the picked colour once there is one.
export default function AccentPicker({ value, onChange, labelledBy }) {
  const picked = pickedHex(value)
  return (
    <div className="accent-picker" role="group" aria-labelledby={labelledBy}>
      {ACCENT_MODES.map((m) => (
        <button
          type="button"
          key={m.id}
          className={`accent-src${value === m.id ? ' on' : ''}`}
          aria-pressed={value === m.id}
          title={m.tagline}
          onClick={() => onChange(m.id)}
        >
          {m.short}
        </button>
      ))}
      <div className="accent-swatches">
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
        {/* A native colour input, dressed as the last swatch: a rainbow until a colour is
            picked, that colour after. Live as the pointer moves. */}
        <label
          className={`accent-swatch accent-custom${picked ? ' on picked' : ''}`}
          style={picked ? { '--sw': picked } : undefined}
          title={picked ? `Your colour, ${picked}` : 'Pick any colour'}
        >
          <input
            type="color"
            aria-label="Custom accent colour"
            value={(picked || '#3AD4C4').toLowerCase()}
            onChange={(e) => onChange(`hex:${e.target.value.toUpperCase()}`)}
          />
        </label>
      </div>
    </div>
  )
}
