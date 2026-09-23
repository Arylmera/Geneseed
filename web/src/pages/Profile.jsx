import React, { useEffect, useState } from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'
import Markdown from '../components/Markdown.jsx'

// Profile — the user's identity (PROFILE.md beside the deployed AGENT.md). Sibling
// to Rules: Rules are what the agent must do, the Profile is who you are — role,
// habits, register preferences. It never binds (precedence is Laws, then user-rules,
// then this). A set-up profile opens as a rendered document; Edit switches to a
// whole-file editor — no per-block structure. The save carries the fingerprint we
// loaded; a refusal means an agent session edited the file first. We reload to learn
// the new fingerprint but KEEP the user's draft on screen — reloading used to replace
// the textarea with the disk copy, silently discarding the edit being saved.

export default function Profile() {
  const { data, error, loading, reload } = useAsync(() => api.profile(), [])
  const [text, setText] = useState('')
  const [fingerprint, setFingerprint] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  // null until first load: an already-written profile opens rendered, an empty one
  // opens straight in the editor.
  const [mode, setMode] = useState(null)
  // Set by a refused save: the next load updates the fingerprint and leaves the text.
  const [keepDraft, setKeepDraft] = useState(false)

  // Sync the editor when a load (or reload) lands — during render against the
  // last-seen payload, not in an effect, so the editor never paints stale text.
  const [seen, setSeen] = useState(null)
  if (data && data !== seen) {
    setSeen(data)
    setFingerprint(data.fingerprint || '')
    if (keepDraft) setKeepDraft(false)
    else setText(data.text || '')
    setMode((m) => m || ((data.text || '').trim() ? 'view' : 'edit'))
  }

  const dirty = !!data && text !== (data.text || '')
  // Leaving with an unsaved edit asks first — the browser's own prompt.
  useEffect(() => {
    if (!dirty) return undefined
    const onLeave = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [dirty])

  if (loading && !data) return <Loading />
  if (error) return <ErrorState error={error} />

  const save = async () => {
    setBusy(true)
    setNotice('')
    try {
      const res = await api.profileSave({ text, fingerprint })
      if (res.ok) {
        setFingerprint(res.fingerprint || '')
        setNotice('Saved.')
        setMode('view')
        reload()
      } else {
        setKeepDraft(true)
        setNotice(
          `${res.detail || 'PROFILE.md changed on disk since you opened it.'} Your edit is ` +
            'kept — Save again to replace the newer version with it.',
        )
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
            Laws, then rules, then this). Seeded once, never overwritten by an update. Prefer not to
            write it by hand? Ask the agent to run the <code className="mono">profile</code> skill —
            it interviews you and drafts this file with your consent.
          </p>
        </div>
        <div className="row" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="seg" role="group" aria-label="Profile mode">
            {[
              ['view', 'View'],
              ['edit', 'Edit'],
            ].map(([k, l]) => (
              <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>
                {l}
              </button>
            ))}
          </div>
          {mode === 'edit' && (
            <button className="btn" disabled={!dirty || busy} onClick={save}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {notice ? <p className="sub rule-notice">{notice}</p> : null}

      {mode === 'edit' ? (
        <textarea
          className="rule-body-input"
          style={{ width: '100%', minHeight: '60vh', fontFamily: 'var(--mono, monospace)' }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          aria-label="Profile markdown"
        />
      ) : text.trim() ? (
        <div className="card pad-lg">
          <Markdown body={text} />
        </div>
      ) : (
        <div className="card pad-lg">
          <p className="sub" style={{ margin: 0 }}>
            No profile yet — switch to Edit to write one, or ask the agent to run the{' '}
            <code className="mono">profile</code> skill.
          </p>
        </div>
      )}
    </>
  )
}
