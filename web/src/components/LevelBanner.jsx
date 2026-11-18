import React from 'react'
import { useViewLevel } from '../hooks/useViewLevel.jsx'
import { LEVELS, rankOf, requiredLevel } from '../lib/tiers.js'

// A link, a bookmark or a lowered level can land the reader on a view above their level. The
// page still renders (the router never reads the level, so nothing is lost or redirected);
// this says why it sits outside the nav and offers the one click that brings it back.
export default function LevelBanner({ route }) {
  const { rank, setLevel } = useViewLevel()
  const required = requiredLevel(route)
  if (rankOf(required) <= rank) return null
  const { label } = LEVELS.find((l) => l.id === required)
  return (
    <div className="level-banner" role="status">
      <span>This is a {label} view.</span>
      <button className="btn sm" onClick={() => setLevel(required)}>
        Show {label} views always
      </button>
    </div>
  )
}
