import React from 'react'

// The shared error banner used when a load fails. Renders nothing when there is
// no error, so callers can drop it in unconditionally.
export default function ErrorState({ error, style }) {
  if (!error) return null
  return <p className="badge bad" style={style}>{error}</p>
}
