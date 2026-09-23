import React from 'react'
import { go } from '../../lib/router.js'
import { SECTIONS } from '../../lib/sections.js'

// One row of the "genome strand" bar chart in the lineage view: a section's
// label, a proportional bar, and its count. Clicking opens the section; the label
// is a real link, so the row is reachable from the keyboard too.
export default function StrandRow({ k, overview, max }) {
  const m = SECTIONS[k]
  const v = overview.counts?.[k] ?? 0
  return (
    <div className="strand" onClick={() => go('#/section/' + k)}>
      <span className="strand-name">
        <span className="strand-dot" />
        <a href={'#/section/' + k} className="strand-link" onClick={(e) => e.stopPropagation()}>
          {m.label}
        </a>
      </span>
      <div className="hbar">
        <i style={{ width: `${(v / max) * 100}%` }} />
      </div>
      <span className="strand-val">{v}</span>
    </div>
  )
}
