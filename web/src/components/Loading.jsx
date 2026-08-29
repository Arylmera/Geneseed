import React from 'react'

// The shared loading placeholder. `label` overrides the default text (e.g.
// Doctor's "Running every check…"). Three shimmering bars under the label stand
// in for the list/card content that is about to land, so a page paints as
// "content coming" instead of a lone text node that reflows away. One generic
// skeleton on purpose — per-page skeletons would be layout to maintain twice.
export default function Loading({ label = 'Loading…' }) {
  return (
    <div className="loading" role="status">
      {label}
      <div className="skel" aria-hidden="true">
        <div className="skel-bar" />
        <div className="skel-bar" />
        <div className="skel-bar" />
      </div>
    </div>
  )
}
