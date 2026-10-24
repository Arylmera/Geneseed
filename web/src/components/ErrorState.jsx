import React from 'react'

// The shared error banner used when a load fails. Renders nothing when there is
// no error, so callers can drop it in unconditionally. It is an alert, so a load that
// fails after the page painted is announced, not only drawn. `onRetry` adds a Retry
// button; without it the markup is the old single badge, so no page changes look.
// `role={null}` is for a caller that is itself the alert (PageBoundary): two nested
// alerts announce twice.
export default function ErrorState({ error, style, onRetry, role = 'alert' }) {
  if (!error) return null
  if (!onRetry)
    return (
      <p className="badge bad" role={role} style={style}>
        {error}
      </p>
    )
  return (
    <div className="error-state" role={role} style={style}>
      <p className="badge bad">{error}</p>
      <button type="button" className="btn sm" onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}
