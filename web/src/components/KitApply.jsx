import React from 'react'
import { kitsLocked } from '../hooks/useKitStaging.js'

// The staged-changes hint and the Apply action closing one install's kit switches, the same
// footer on Installs / Kits and on a kit's page.
export default function KitApply({ row, stage }) {
  const { on, off } = stage.change(row)
  const dirty = on.length + off.length > 0
  return (
    <div className="kit-foot">
      <span className={`kit-hint${dirty ? ' staged' : ''}`} role="status">
        {dirty
          ? [...on.map((k) => `turn on ${k}`), ...off.map((k) => `turn off ${k}`)].join(' · ')
          : 'No staged changes'}
      </span>
      <button
        type="button"
        className="btn soft sm"
        aria-label={`Apply kits for ${row.host} · ${row.scope}`}
        disabled={kitsLocked(row) || !dirty}
        onClick={() => stage.apply(row)}
      >
        Apply
      </button>
    </div>
  )
}

const STATE = { active: ['Active', 'ok'], disabled: ['Disabled', 'warn'] }
export const KitState = ({ row }) => {
  const [label, tone] = STATE[row.state] || [row.state || 'Unknown', '']
  return <span className={`tag ${tone}`}>{label}</span>
}
