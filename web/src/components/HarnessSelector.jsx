import React from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'

// Re-points the whole console at one detected install. Lists the ACTIVE installs only
// (others have no data to view); selecting one updates memory, edits, and inventory
// everywhere. Hidden when there's nothing to switch between. Refetches on dataRev so the
// option set + current selection stay in sync after a toggle/install.
export default function HarnessSelector({ dataRev, onSwitch }) {
  const { data } = useAsync(() => api.installs(), [dataRev])
  const active = (data?.installs || []).filter((i) => i.state === 'active')
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
    <div
      className="row gap-8"
      style={{ alignItems: 'center' }}
      title="Harness the console is viewing"
    >
      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>harness</span>
      <select className="sel" aria-label="harness to view" value={current.id} onChange={onChange}>
        {active.map((i) => (
          <option key={i.id} value={i.id}>
            {i.host} · {i.scope}
          </option>
        ))}
      </select>
    </div>
  )
}
