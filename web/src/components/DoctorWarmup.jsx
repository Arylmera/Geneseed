import React from 'react'

// The daemon's first health check can take a while on a cold start. Until its verdict lands the
// page says what is happening, in plain words; if the hook (useOverview) has given up asking, it
// says so and offers one button to try again, so the wait is never a dead end.
export default function DoctorWarmup({ warmup, onRecheck }) {
  if (!warmup) return null
  const slow = warmup === 'slow'
  return (
    <div className="level-banner" role="status" aria-live="polite">
      <span>{slow ? 'The check is taking longer than usual.' : 'Checking your installs…'}</span>
      {slow && onRecheck ? (
        <button type="button" className="btn sm" onClick={onRecheck}>
          Check again
        </button>
      ) : null}
    </div>
  )
}
