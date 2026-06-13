import React from 'react'

// The shared loading placeholder. `label` overrides the default text (e.g.
// Doctor's "Running every check…").
export default function Loading({ label = 'Loading…' }) {
  return <div className="loading">{label}</div>
}
