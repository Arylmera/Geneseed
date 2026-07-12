import React, { useEffect, useState } from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'

// Profile — the user's identity (PROFILE.md beside the deployed AGENT.md). Sibling
// to Rules: Rules are what the agent must do, the Profile is who you are — role,
// habits, register preferences. It never binds (precedence is Laws, then user-rules,
// then this), so this page is a plain whole-file editor, no per-block structure. The
// save carries the fingerprint we loaded; a 409 means an agent session edited the
// file first, and we reload instead of clobbering its write.

export default function Profile() {
  const { data, error, loading, reload } = useAsync(() => api.profile(), [])
  const [text, setText] = useState('')
  const [fingerprint, setFingerprint] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  // Sync the editor when a load (or reload) lands. Keyed on fingerprint so a save's
  // own reload doesn't stomp on-screen text with identical content.
  useEffect(() => {
    if (data) {
      setText(data.text || '')
      setFingerprint(data.fingerprint || '')
    }
  }, [data && data.fingerprint])

  if (loading && !data) return <Loading />
  if (error) return <ErrorState message={error} onRetry={reload} />

  const dirty = data && text !== (data.text || '')

  const save = async () => {
    setBusy(true)
    setNotice('')
    try {
      const res = await api.profileSave({ text, fingerprint })
      if (res.ok) {
        setFingerprint(res.fingerprint || '')
        setNotice('Saved.')
        reload()
      } else {
        setNotice(res.detail || 'Could not save — reloading.')
        reload()
      }
    } catch (e) {
      setNotice(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="head-row mb-16">
        <div>
          <div className="eyebrow">identity · yours</div>
          <h1 className="h">Profile</h1>
          <p className="sub">
            Who you are and how you like to work, from <code className="mono">PROFILE.md</code>{' '}
            beside the deployed AGENT.md. Unlike <code className="mono">user-rules.md</code>, it is
            identity, not rules — it colours how the agent works but never binds (precedence is
            Laws, then rules, then this). Seeded once, never overwritten by an update.
          </p>
        </div>
        <button className="btn" disabled={!dirty || busy} onClick={save}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>

      {notice ? <p className="sub rule-notice">{notice}</p> : null}

      <textarea
        className="rule-body-input"
        style={{ width: '100%', minHeight: '60vh', fontFamily: 'var(--mono, monospace)' }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        aria-label="Profile markdown"
      />
    </>
  )
}
