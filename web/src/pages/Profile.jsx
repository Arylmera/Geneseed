import React, { useState } from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'
import { useFileEditor } from '../hooks/useFileEditor.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'
import Markdown from '../components/Markdown.jsx'
import Seg from '../components/Seg.jsx'

// Profile — the user's identity (PROFILE.md beside the deployed AGENT.md). Sibling
// to Rules: Rules are what the agent must do, the Profile is who you are — role,
// habits, register preferences. It never binds (precedence is Laws, then user-rules,
// then this). A set-up profile opens as a rendered document; Edit switches to a
// whole-file editor — no per-block structure. The draft, the fingerprint, the 409 and
// the leave-guard are useFileEditor's: a refused save reloads the disk copy into the
// VIEW and keeps the draft in the editor.

const CONFLICT =
  'PROFILE.md changed on disk since you opened it — reloaded the fresh copy. ' +
  'Your draft is kept — Save again.'

export default function Profile({ onChanged }) {
  const { data, error, loading, reload, setData } = useAsync(() => api.profile(), [])
  const editor = useFileEditor({ data, reload })
  const { draft, dirty, busy, notice } = editor
  // An empty profile opens straight in the editor — once, on the first load.
  const [started, setStarted] = useState(false)
  if (data && !started) {
    setStarted(true)
    if (!(data.text || '').trim()) editor.open(data.text || '')
  }

  if (loading && !data) return <Loading />
  if (error) return <ErrorState error={error} />

  const editing = draft !== null
  const text = data?.text || ''

  const save = async () => {
    const res = await editor.save((fp) => api.profileSave({ text: draft, fingerprint: fp }), {
      conflict: CONFLICT,
    })
    if (!res) return
    // Paint the saved text at once; the reload the editor fired confirms it.
    setData((d) => ({ ...d, text: draft, fingerprint: res.fingerprint || '' }))
    editor.setNotice('Saved.')
    editor.close()
    onChanged?.()
  }

  return (
    <>
      <div className="head-row mb-16">
        <div>
          <div className="eyebrow">identity · yours</div>
          <h2 className="h">Profile</h2>
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
          <Seg aria-label="Profile mode">
            <button className={editing ? '' : 'on'} onClick={editor.discard}>
              View
            </button>
            <button className={editing ? 'on' : ''} onClick={() => editing || editor.open(text)}>
              Edit
            </button>
          </Seg>
          {editing && (
            <button className="btn" disabled={!dirty || busy} onClick={save}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {notice ? <p className="sub rule-notice">{notice}</p> : null}

      {editing ? (
        <textarea
          className="rule-body-input"
          style={{ width: '100%', minHeight: '60vh', fontFamily: 'var(--mono, monospace)' }}
          value={draft}
          onChange={(e) => editor.setDraft(e.target.value)}
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
