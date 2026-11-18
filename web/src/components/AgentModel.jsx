import React, { useState } from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'

// One agent's model on one install (GET /api/agent-models): its tier from the agent's source, the
// model it resolves to there and why, and a pin. The pin is `agents.<name>.model` in that
// install's agent-overrides.json; it outranks the tier. On a host that is not Claude Code only the
// tier shows: the other hosts' agents inherit, and this page does not edit their pins. Saving
// edits the file; the model reaches the agent file at the next rebuild, which the note says.
const TIER_TONE = { strong: 'acc', standard: '', light: 'ok' }
const FROM = {
  pin: 'your pin',
  map: 'the tiers map',
  default: 'the tier default',
  inherit: 'your session model',
}

export default function AgentModel({ name, install, installName }) {
  const { data, error, setData } = useAsync(
    () => Promise.resolve().then(() => api.agentModels(install)),
    [name, install?.host, install?.path],
  )
  const [draft, setDraft] = useState(null)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const row = data?.agents?.find((a) => a.name === name)
  if (error || !row) return null
  // The server names the tier in each alias warning; a pinned agent has none to show.
  const warning =
    row.from === 'pin' ? null : data.warnings?.find((w) => w.includes(`the ${row.tier} tier`))
  const where = installName ? ` on ${installName}` : ''
  const pin = row.pin ?? ''
  const value = draft ?? pin
  const send = async (model) => {
    setBusy(true)
    setErr('')
    try {
      const res = await api.agentModelsSave({ agents: { [name]: model } }, install)
      setData(res)
      setDraft(null)
      setSaved(true)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="agent-model" role="group" aria-label={`Model of ${name}`}>
      <div className="row gap-8 wrap">
        {row.tier ? (
          <span
            className={`tag ${TIER_TONE[row.tier] ?? ''}`}
            title="The tier this agent's source declares"
          >
            {row.tier} tier
          </span>
        ) : (
          <span className="tag" title="No Geneseed source: not tiered">
            not tiered
          </span>
        )}
        {data.claude ? (
          <span className="sub" data-testid="agent-model-effective">
            {row.model ? (
              <>
                runs on <code>{row.model}</code> ({FROM[row.from]})
              </>
            ) : (
              <>runs on your session model</>
            )}
            {where}
          </span>
        ) : null}
      </div>
      {data.claude ? (
        <>
          <label className="row gap-8 wrap">
            <span className="dim">Pin a model</span>
            <input
              className="inp"
              type="text"
              aria-label={`pin a model for ${name}`}
              placeholder="none: follows the tier"
              disabled={!!data.file?.problem || busy}
              value={value}
              onChange={(e) => {
                setDraft(e.target.value)
                setSaved(false)
              }}
            />
            <button
              type="button"
              className="btn ghost sm"
              disabled={busy || !!data.file?.problem || draft === null || draft.trim() === pin}
              onClick={() => send(draft.trim())}
            >
              Save pin
            </button>
            {pin ? (
              <button
                type="button"
                className="btn ghost sm"
                disabled={busy || !!data.file?.problem}
                onClick={() => send(null)}
              >
                Clear pin
              </button>
            ) : null}
          </label>
          {data.file?.problem ? (
            <p className="sub tiers-warn" role="alert">
              {data.file.problem}.
            </p>
          ) : null}
          {warning ? (
            <p className="sub tiers-warn" role="note">
              {warning}
            </p>
          ) : null}
          {err ? (
            <p className="sub tiers-warn" role="alert">
              {err}
            </p>
          ) : null}
          {saved ? (
            <p className="sub">
              Saved. The agent file changes at the next rebuild of this install.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
