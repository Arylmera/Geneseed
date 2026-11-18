import React, { useState } from 'react'
import { api } from '../../api/index.js'
import { useAsync } from '../../hooks/useAsync.js'

// The `tiers` map of one Claude Code install's agent-overrides.json: the model each non-strong tier
// runs on (GET/POST /api/agent-models). `standard` and `light` are fields; an empty one means the
// agents of that tier use your session model; a field left on its default alias is not written, so
// the default can move with a release. `strong` is not a field: it is always the session model.
// Saving edits the file only: the model reaches the agent files at the next rebuild, which this
// block offers (`onRebuild`).
const TIERS = [
  ['standard', 'Standard'],
  ['light', 'Light'],
]

export default function TiersEditor({ inst, who, onRebuild }) {
  const install = { host: inst.host, path: inst.path }
  const { data, error, setData } = useAsync(
    () => Promise.resolve().then(() => api.agentModels(install)),
    [inst.host, inst.path],
  )
  const [draft, setDraft] = useState({})
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  if (error) return <p className="sub">The model tiers could not be read: {error}</p>
  if (!data) return null
  const problem = data.file?.problem
  // What the file says now: a named key (an empty one included) or else the tier's default alias.
  const now = (t) => (Object.hasOwn(data.map, t) ? data.map[t] : (data.defaults[t] ?? ''))
  const value = (t) => draft[t] ?? now(t)
  const dirty = TIERS.some(([t]) => draft[t] !== undefined && draft[t].trim() !== now(t))

  const save = async () => {
    const tiers = {}
    for (const [t] of TIERS) {
      if (draft[t] === undefined) continue
      const v = draft[t].trim()
      if (v === now(t)) continue
      // The default alias is "no key": the map stays minimal and a later release can move it.
      tiers[t] = v === data.defaults[t] ? null : v
    }
    setBusy(true)
    setErr('')
    try {
      const res = await api.agentModelsSave({ tiers }, install)
      setData(res)
      setDraft({})
      setSaved(true)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ip-block tiers-editor" role="group" aria-label={`Model tiers for ${who}`}>
      <span className="ip-label">Models by tier</span>
      <div className="tiers-row">
        <span className="dim">Strong</span>
        <span className="dim">your session model</span>
      </div>
      {TIERS.map(([t, title]) => (
        <label className="tiers-row" key={t}>
          <span>{title}</span>
          <input
            className="inp"
            type="text"
            aria-label={`${t} tier model for ${who}`}
            placeholder="session model"
            disabled={!!problem || busy}
            value={value(t)}
            onChange={(e) => {
              setDraft((d) => ({ ...d, [t]: e.target.value }))
              setSaved(false)
            }}
          />
        </label>
      ))}
      <p className="sub">
        Empty means the agents of that tier use your session model. Defaults: standard{' '}
        <code>{data.defaults.standard}</code>, light <code>{data.defaults.light}</code>.
      </p>
      {problem ? (
        <p className="sub tiers-warn" role="alert">
          {problem}.
        </p>
      ) : null}
      {data.warnings.map((w) => (
        <p className="sub tiers-warn" role="note" key={w}>
          {w}
        </p>
      ))}
      {err ? (
        <p className="sub tiers-warn" role="alert">
          {err}
        </p>
      ) : null}
      <div className="row gap-8">
        <button
          type="button"
          className="btn ghost sm"
          disabled={!dirty || !!problem || busy}
          onClick={save}
        >
          Save models
        </button>
        {saved && onRebuild ? (
          <>
            <span className="sub">Saved. The agent files change at the next rebuild.</span>
            <button type="button" className="btn ghost sm" onClick={onRebuild}>
              Rebuild…
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
