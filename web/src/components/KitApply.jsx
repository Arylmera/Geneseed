import React from 'react'
import { kitsLocked } from '../hooks/useKitStaging.js'

// What one install's kit staging says: rebuilding, the last rebuild failed, or the staged
// switches. Shared by this footer and the Kits page's staged-changes bar, so both say it alike.
export function kitHint(row, stage) {
  const { on, off } = stage.change(row)
  if (stage.running(row)) return 'Rebuilding…'
  const staged = [...on.map((k) => `turn on ${k}`), ...off.map((k) => `turn off ${k}`)].join(' · ')
  const failed = stage.failed(row) ? 'Last rebuild failed — see console' : ''
  return [failed, staged].filter(Boolean).join(' · ') || 'No staged changes'
}

// The staged-changes hint and the Apply action closing one install's kit switches, the same
// footer on Installs / Kits and on a kit's page. While this row's rebuild runs it says so and
// Apply waits; while any other job runs Apply waits too, titled why; after a failed one the
// staged set is still there, and the hint says why.
export default function KitApply({ row, stage }) {
  const { on, off } = stage.change(row)
  const dirty = on.length + off.length > 0
  const running = stage.running(row)
  return (
    <div className="kit-foot">
      <span className={`kit-hint${dirty ? ' staged' : ''}`} role="status">
        {kitHint(row, stage)}
      </span>
      <button
        type="button"
        className="btn soft sm"
        aria-label={`Apply kits for ${row.host} · ${row.scope}`}
        disabled={kitsLocked(row) || !dirty || running || stage.busy}
        title={stage.busy && !running ? 'A job is running' : undefined}
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
