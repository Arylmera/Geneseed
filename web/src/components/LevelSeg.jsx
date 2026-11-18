import React from 'react'
import Seg from './Seg.jsx'
import { LEVELS } from '../lib/tiers.js'
import { useViewLevel } from '../hooks/useViewLevel.jsx'

// The view-level switch, one control for the two places that offer it (the Appearance popover and
// the Settings sheet) so they cannot drift. Both read the one provider, so either moves the other.
export default function LevelSeg({ labelledBy }) {
  const { level, setLevel } = useViewLevel()
  return (
    <Seg aria-labelledby={labelledBy}>
      {LEVELS.map((l) => (
        <button
          type="button"
          key={l.id}
          className={level === l.id ? 'on' : ''}
          aria-pressed={level === l.id}
          onClick={() => setLevel(l.id)}
        >
          {l.label}
        </button>
      ))}
    </Seg>
  )
}
