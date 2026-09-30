import React from 'react'
import { api } from '../api/index.js'

// Re-points the whole console at one detected install. Lists the ACTIVE installs only
// (others have no data to view); selecting one updates memory, edits, and inventory
// everywhere. Hidden when there's nothing to switch between. `installs` is App's one
// copy of /api/installs (the sidebar's Installs count reads the same list), refetched on
// every data revision, so the option set and the selection stay in sync after a toggle.
export default function HarnessSelector({ installs, onSwitch }) {
  const active = (installs || []).filter((i) => i.state === 'active')
  if (active.length < 2) return null

  const current = active.find((i) => i.selected) || active[0]
  const onChange = async (e) => {
    const inst = active.find((i) => i.id === e.target.value)
    if (!inst) return
    try {
      await api.selectView(inst.host, inst.path)
      onSwitch?.() // refetch the overview + every panel against the newly-selected install
    } catch {
      /* ignore — the select snaps back to the server's current on the next refetch */
    }
  }

  return (
    <select
      className="sel tb-harness"
      aria-label="Harness to view"
      title="Harness the console is viewing"
      value={current.id}
      onChange={onChange}
    >
      {active.map((i) => (
        <option key={i.id} value={i.id}>
          {i.host} · {i.scope}
        </option>
      ))}
    </select>
  )
}
