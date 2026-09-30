import React from 'react'
import { SECTIONS } from '../../lib/sections.js'

// One row of the "genome strand" bar chart in the lineage view: a section's
// label, a proportional bar, and its count. The label is the row's one link, and it
// is stretched over the whole row (.stretch-link), so the row clicks like it used to
// without a second, mouse-only handler on the div.
export default function StrandRow({ k, overview, max }) {
  const m = SECTIONS[k]
  const v = overview.counts?.[k] ?? 0
  return (
    <div className="strand">
      <span className="strand-name">
        <span className="strand-dot" />
        <a href={'#/section/' + k} className="strand-link stretch-link">
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
