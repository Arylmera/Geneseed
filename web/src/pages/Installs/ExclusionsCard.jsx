import React, { useState } from 'react'
import { Icon } from '../../components/Icon.jsx'
import { api } from '../../api/index.js'
import { useAsync } from '../../hooks/useAsync.js'

// Sovereign-repo exclusions: folders where every global install goes dormant. Its own
// small card, self-contained (own fetch/reload) so it doesn't need to thread through the
// harness table's dataRev/onMutated — /api/excludes' `installs` field is a DIFFERENT list
// than the harness table's (host, scope, path) rows: it's excludes_snapshot()'s "which
// global installs exist to manage exclusions for", so the card hides itself independently
// of whatever the table above is showing.
export default function ExclusionsCard() {
  const { data, error, reload } = useAsync(() => api.excludes(), [])
  const [busy, setBusy] = useState(false)
  const [msgs, setMsgs] = useState([])

  const mutate = async (action, path) => {
    setBusy(true)
    try {
      const res = await api.excludeMutate(action, path)
      setMsgs(res.messages || [])
    } catch (e) {
      // A 409 (nothing to remove, no global install) throws — the body still carries
      // the human messages exclude_add/exclude_remove built, same as Rules.jsx's mutate.
      setMsgs(e.body?.messages || [e.message])
    } finally {
      setBusy(false)
      reload()
    }
  }

  const pick = async () => {
    setBusy(true)
    try {
      const r = await api.pickFolder()
      if (r.path) await mutate('add', r.path)
      else if (r.error) setMsgs([r.error])
    } catch (e) {
      setMsgs([e.message])
    } finally {
      setBusy(false)
    }
  }

  if (error || !data?.installs?.length) return null // no global install -> nothing to manage

  return (
    <div className="card pad-lg mb-16">
      <div className="card-head">
        <h3>Excluded folders</h3>
      </div>
      <p className="sub mb-16">
        Sovereign repos: inside these folders every global harness goes dormant — hooks stay silent
        and the global preamble is not loaded.
      </p>
      {(data.excludes || []).map((e) => (
        <div className="row wrap between gap-12" key={e.path}>
          <code>{e.path}</code>
          <span className="mono muted">[{e.hosts.join(', ')}]</span>
          <button className="btn ghost sm" disabled={busy} onClick={() => mutate('remove', e.path)}>
            Remove
          </button>
        </div>
      ))}
      <button className="btn ghost sm" disabled={busy} onClick={pick}>
        <Icon name="folder" /> Exclude a folder…
      </button>
      {msgs.map((m, i) => (
        <p key={i} className="sub">
          {m}
        </p>
      ))}
    </div>
  )
}
