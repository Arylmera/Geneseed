import React from 'react'

// The fleet verdict's head (lib/overview.js fleetVerdict), as one toned badge in each lens
// hero — the same truth the Ledger leads with, so a lens can no longer say "ready" over a
// harness the Ledger calls broken. Nothing until the fleet answers: a guess would be worse.
const BADGE = { good: 'ok', warn: 'warn', bad: 'bad' }

export default function VerdictBadge({ verdict }) {
  if (!verdict) return null
  return (
    // alignSelf: the heroes it sits in are flex columns, which would stretch it full width.
    <span
      className={`badge ${BADGE[verdict.tone]}`}
      role="status"
      style={{ alignSelf: 'flex-start' }}
    >
      <span className="dot" />
      {verdict.head}
    </span>
  )
}
