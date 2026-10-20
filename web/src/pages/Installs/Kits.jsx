import React, { useState } from 'react'
import { api } from '../../api/index.js'
import { useAsync } from '../../hooks/useAsync.js'
import Loading from '../../components/Loading.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import { useConfirm } from '../../hooks/useConfirm.jsx'
import { Switch } from './controls.jsx'

const same = (a, b) => a.size === b.size && [...a].every((k) => b.has(k))

// Installs / Kits: one card per install with a switch per kit. Toggling only stages a set;
// Apply confirms, then rebuilds that install with exactly that set (replace, not replay).
// The rebuild is a job, so the result streams in the console and the next fetch (dataRev)
// shows the row as it now is, kept-edited files included.
export default function Kits({ onAction, dataRev }) {
  const confirm = useConfirm()
  const { data, error } = useAsync(() => api.kits(), [dataRev])
  const [pending, setPending] = useState(() => new Map()) // install id -> Set of kit names
  // A refetch (a finished rebuild bumps dataRev) is the new truth: staged edits against the old one go.
  const [seen, setSeen] = useState(data)
  if (seen !== data) {
    setSeen(data)
    setPending(new Map())
  }
  if (error || data?.error) return <ErrorState error={error || data.error} />
  if (!data) return <Loading />

  if (!data.installs.length) return <div className="empty inst-empty">No install yet.</div>
  if (!data.kits.length) return <div className="empty inst-empty">This Geneseed ships no kit.</div>

  const setOf = (row) => pending.get(row.id) ?? new Set(row.kits)
  const toggle = (row, name) => {
    const next = new Set(setOf(row))
    if (!next.delete(name)) next.add(name)
    setPending(new Map(pending).set(row.id, next))
  }
  const apply = async (row) => {
    const kits = [...setOf(row)]
    const msg =
      `Rebuild ${row.host} · ${row.scope} with kits: ${kits.join(', ') || 'none'}? ` +
      'Members of kits turned off are removed; files you edited are kept.'
    if (await confirm(msg, { confirmLabel: 'Rebuild' })) {
      onAction('install', { host: row.host, path: row.path, kits })
    }
  }

  return data.installs.map((row) => {
    const locked = !row.editable || row.state === 'unreadable'
    const set = setOf(row)
    const dirty = !same(set, new Set(row.kits))
    return (
      <div className="card pad-lg mb-16" key={row.id}>
        <div className="row wrap between gap-12">
          <h3>
            {row.host} · {row.scope}
          </h3>
          <span className="mono muted">{row.path}</span>
        </div>
        {locked && <p className="sub">{row.reason || row.error}</p>}
        {data.kits.map((k) => (
          <div className="row wrap between gap-12" key={k.name} title={k.description}>
            <span>
              {k.name}{' '}
              <span className="mono muted">
                {k.skills.length} skills · {k.agents.length} agents
              </span>
            </span>
            <Switch
              on={set.has(k.name)}
              disabled={locked}
              label={`${k.name} for ${row.host} · ${row.scope}`}
              onToggle={() => toggle(row, k.name)}
            />
          </div>
        ))}
        {Object.entries(row.keptKitFiles || {}).map(([k, files]) => (
          <p className="mono muted" key={k}>
            kept from inactive kit {k}: {files.join(', ')} — delete by hand
          </p>
        ))}
        <button
          className="btn sm"
          aria-label={`Apply kits for ${row.host} · ${row.scope}`}
          disabled={locked || !dirty}
          onClick={() => apply(row)}
        >
          Apply
        </button>
      </div>
    )
  })
}
