import React from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'
import { storeInstallPick } from '../hooks/useInstalls.js'

// One agent's model on one install, as a line: its tier, the model it runs on and where to change it
// (GET /api/agent-models?models=0). Setting it is the Models page's job; the Library only reads.
// Shown only where the host takes a per-agent model, so Bob shows nothing.
export default function AgentModelLine({ name, install, installId }) {
  const { data, error } = useAsync(
    () => Promise.resolve().then(() => api.agentModels(install, { light: true })),
    [name, install?.host, install?.path],
  )
  const row = data?.agents?.find((a) => a.name === name)
  if (error || !data?.claude || !row) return null
  return (
    <p className="sub agent-model" data-testid="agent-model-line">
      {row.tier ? `${row.tier} tier` : 'not tiered'}
      {' · runs on '}
      {row.model ? <code>{row.model}</code> : 'your session model'}
      {' — '}
      <a href="#/models" onClick={() => installId && storeInstallPick('models', installId)}>
        Change on Models →
      </a>
    </p>
  )
}
