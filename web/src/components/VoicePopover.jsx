import React, { useEffect, useRef } from 'react'
import { accentHex } from '../lib/accents.js'

// The voice/theme switcher that drops from the rail foot. Closes on an outside
// click; picking a theme rebuilds the deployed harness in that voice.
export default function VoicePopover({ themes, current, onPick, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])
  return (
    <div className="pop" ref={ref}>
      <div className="tick" style={{ padding: '4px 10px 8px' }}>Switch voice</div>
      {themes.map((t) => (
        <div key={t.name} className={`pop-item ${t.name === current ? 'on' : ''}`}
          onClick={() => onPick(t.name)}>
          <span className="po" style={{ background: accentHex(t.accent),
            boxShadow: `0 0 8px ${accentHex(t.accent)}` }} />
          <span className="pn">{t.name}</span>
        </div>
      ))}
    </div>
  )
}
