import React from 'react'
import { go } from '../../lib/router.js'
import { SECTIONS } from '../../lib/sections.js'

// One row of the "genome strand" bar chart in the lineage view: a section's
// label, a proportional bar, and its count. Clicking opens the section.
export default function StrandRow({ k, overview, max }) {
  const m = SECTIONS[k]
  const v = overview.counts?.[k] ?? 0
  return (
    <div className="row between" style={{ padding: '13px 0', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
      onClick={() => go('#/section/' + k)}>
      <div className="row" style={{ gap: 12, minWidth: 150 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} />
        <span style={{ fontWeight: 600 }}>{m.label}</span>
      </div>
      <div className="hbar" style={{ flex: 1, margin: '0 16px' }}><i style={{ width: `${(v / max) * 100}%` }} /></div>
      <span className="mono" style={{ width: 34, textAlign: 'right', fontSize: 14 }}>{v}</span>
    </div>
  )
}
