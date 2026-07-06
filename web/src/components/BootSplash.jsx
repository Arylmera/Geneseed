import React, { useEffect, useState } from 'react'

// Startup splash: sprout germinates inside the dial while the progress ring fills,
// then the overlay fades out. Dismissal waits for BOTH a minimum display time AND
// the first overview fetch — whichever is later — so we never hide before the
// dashboard has data. Mounts once per app load.
//
// Accent inherits from `.app`'s `--accent` CSS var, so the user's selected
// voice/flavour theme tints the ring, sprout and caret automatically.
//
// This is a daily local tool: the ceremony is capped so it never costs more
// than half a second, and App skips it entirely on warm same-session loads.
const MIN_DISPLAY_MS = 550

export default function BootSplash({ ready, onDone }) {
  const [minElapsed, setMinElapsed] = useState(false)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), MIN_DISPLAY_MS)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (ready && minElapsed) setFading(true)
  }, [ready, minElapsed])

  const handleAnimEnd = (e) => {
    if (e.animationName === 'splashOut') onDone?.()
  }

  return (
    <div
      className={`boot-splash${fading ? ' fading' : ''}`}
      aria-hidden="true"
      onAnimationEnd={handleAnimEnd}
    >
      <div className="boot-dial">
        <svg className="boot-ring" viewBox="0 0 172 172">
          <circle cx="86" cy="86" r="72" fill="none" stroke="var(--surface-3)" strokeWidth="9" />
          <circle
            cx="86"
            cy="86"
            r="50"
            fill="none"
            stroke="var(--line-2)"
            strokeWidth="8"
            strokeDasharray="1.2 5.3"
            opacity=".7"
          />
          <circle
            className="boot-progress"
            cx="86"
            cy="86"
            r="72"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="9"
            strokeLinecap="round"
          />
        </svg>
        <svg className="boot-sprout" viewBox="0 0 24 24">
          <path
            className="bs-stem"
            d="M12 21.5v-9"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
          <path
            className="bs-leaf bs-leaf-main"
            d="M12 13c0-4.5 3.2-7.5 7.5-7.5 0 4.5-3.2 7.5-7.5 7.5z"
            fill="var(--accent)"
          />
          <path
            className="bs-leaf bs-leaf-back"
            d="M12 14.5c0-3.6-2.6-6-6-6 0 3.6 2.6 6 6 6z"
            fill="var(--accent)"
            opacity=".42"
          />
          <circle cx="12" cy="12.4" r="1.1" fill="var(--bg)" />
        </svg>
      </div>
      <div className="boot-status">
        <span>germinating harness</span>
        <span className="boot-caret" />
      </div>
    </div>
  )
}
