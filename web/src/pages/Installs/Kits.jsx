import React from 'react'
import { api } from '../../api/index.js'
import { useAsync } from '../../hooks/useAsync.js'
import Loading from '../../components/Loading.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import KitApply, { KitState } from '../../components/KitApply.jsx'
import { kitsLocked, useKitStaging } from '../../hooks/useKitStaging.js'
import { Switch } from './controls.jsx'

// Installs / Kits: one panel per install (the Hosts tab's panel + head) with a switch per
// kit. The staging, confirm and rebuild live in hooks/useKitStaging.js (the staged sets in the
// App-level store, hooks/useStaging.jsx), shared with the Kits page.
export default function Kits({ onAction, dataRev }) {
  const { data, error } = useAsync(() => api.kits(), [dataRev])
  const stage = useKitStaging(data, onAction)
  if (error || data?.error) return <ErrorState error={error || data.error} />
  if (!data) return <Loading />

  if (!data.installs.length) return <div className="empty inst-empty">No install yet.</div>
  if (!data.kits.length) return <div className="empty inst-empty">This Geneseed ships no kit.</div>

  return (
    <div className="kits-tab">
      {data.installs.map((row) => {
        const locked = kitsLocked(row)
        const set = stage.setOf(row)
        const who = `${row.host} · ${row.scope}`
        return (
          <section className="panel flush" key={row.id} aria-label={who}>
            <div className="inst-head">
              <div>
                <h2>{who}</h2>
                <p className="dim mono">{row.path}</p>
              </div>
              <KitState row={row} />
            </div>
            {locked && <p className="kit-lock">{row.reason || row.error}</p>}
            <ul className="kit-list">
              {data.kits.map((k) => (
                <li className="kit-row" key={k.name}>
                  <div className="kit-main">
                    <a className="kit-name" href={`#/kits/${encodeURIComponent(k.name)}`}>
                      {k.name}
                    </a>
                    {k.description ? <span className="kit-desc">{k.description}</span> : null}
                    <span className="mono dim">
                      {(k.skills || []).length} skills · {(k.agents || []).length} agents
                    </span>
                  </div>
                  <Switch
                    on={set.has(k.name)}
                    disabled={locked || stage.running(row)}
                    label={`${k.name} for ${who}`}
                    onToggle={() => stage.toggle(row, k.name)}
                  />
                </li>
              ))}
            </ul>
            {Object.entries(row.keptKitFiles || {}).map(([k, files]) => (
              <p className="kit-kept mono dim" key={k}>
                kept from inactive kit {k}: {files.join(', ')} — delete by hand
              </p>
            ))}
            <KitApply row={row} stage={stage} />
          </section>
        )
      })}
    </div>
  )
}
