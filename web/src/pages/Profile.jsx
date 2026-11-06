import React, { useState } from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'
import { useFileEditor } from '../hooks/useFileEditor.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'
import EmptyState from '../components/EmptyState.jsx'
import Markdown from '../components/Markdown.jsx'
import Seg from '../components/Seg.jsx'
import { useInstallFiles } from '../hooks/useInstalls.js'
import { installTag, pairOf } from '../lib/hosts.js'

// Profile — the user's identity (PROFILE.md, one file shared by every global install). Sibling
// to Rules: Rules are what the agent must do, the Profile is who you are — role,
// habits, register preferences. It never binds. A set-up profile opens as a rendered document; Edit switches to a
// whole-file editor — no per-block structure. The draft, the fingerprint, the 409 and
// the leave-guard are useFileEditor's: a refused save reloads the disk copy into the
// VIEW and keeps the draft in the editor.

const CONFLICT =
  'PROFILE.md changed on disk since you opened it — reloaded the fresh copy. ' +
  'Your draft is kept — Save again.'

// ONE CARD PER PROFILE FILE: the installs on the shared tier share one, tagged shared, and a project
// install keeps its own, tagged with its install. An install whose read failed keeps a card of its
// own, which says so, tagged with its install: `shared` names the one card the shared file got.
// Personal's header states the shared scope; a card only says which it is.
const idOf = (inst) => inst?.id ?? ''

export default function Profile({ onChanged, dataRev }) {
  const { targets, sets, failed } = useInstallFiles(api.profile, dataRev)
  if (!sets) return <Loading />
  // By id, never by object: a refetch lands new rows while `sets` still holds the old ones, and a
  // card dropped for that takes its unsaved draft with it.
  const unread = new Set(failed.map(idOf))
  const listed = new Set([...sets.map((s) => idOf(s.inst)), ...unread])
  const cards = targets
    .filter((i) => listed.has(idOf(i)))
    .map((install) => ({
      install,
      tag:
        targets.length < 2
          ? null
          : install?.shared && !unread.has(idOf(install))
            ? 'shared'
            : installTag(install),
    }))
  return (
    <>
      <div className="mb-16">
        <h2 className="h">Profile</h2>
        <p className="sub sub-wide">
          Who you are and how you like to work, from <code className="mono">PROFILE.md</code>. It
          guides the agent and never binds it. <a href="#/docs/collaboration">Docs</a>
        </p>
      </div>
      {cards.map(({ install, tag }) => (
        <ProfileOf key={idOf(install)} install={install} tag={tag} onChanged={onChanged} />
      ))}
    </>
  )
}

// One PROFILE.md: its own read, draft, fingerprint and save.
function ProfileOf({ install, tag, onChanged }) {
  const { data, error, loading, reload, setData } = useAsync(() => api.profile(pairOf(install)), [])
  const editor = useFileEditor({ data, reload })
  const { draft, dirty, busy, notice } = editor
  // An empty profile opens straight in the editor — once, on the first load.
  const [started, setStarted] = useState(false)
  if (data && !started) {
    setStarted(true)
    if (!(data.text || '').trim()) editor.open(data.text || '')
  }

  if (loading && !data) return <Loading />
  if (error) {
    return (
      <section aria-label={tag ? `Profile, ${tag}` : undefined}>
        {tag ? <span className="rule-chip mono">{tag}</span> : null}
        <ErrorState error={error} onRetry={reload} />
      </section>
    )
  }

  const editing = draft !== null
  const text = data?.text || ''

  const save = async () => {
    const res = await editor.save(
      (fp) => api.profileSave({ text: draft, fingerprint: fp }, pairOf(install)),
      {
        conflict: CONFLICT,
      },
    )
    if (!res) return
    // Paint the saved text at once; the reload the editor fired confirms it.
    setData((d) => ({ ...d, text: draft, seeded: false, fingerprint: res.fingerprint || '' }))
    editor.setNotice('Saved.')
    editor.close()
    onChanged?.()
  }

  return (
    <section aria-label={tag ? `Profile, ${tag}` : undefined}>
      <div className="head-row mb-16">
        <div>{tag ? <span className="rule-chip mono">{tag}</span> : null}</div>
        <div className="row">
          <Seg aria-label={tag ? `Profile mode, ${tag}` : 'Profile mode'}>
            <button
              className={editing ? '' : 'on'}
              aria-pressed={!editing}
              onClick={editor.discard}
            >
              View
            </button>
            <button
              className={editing ? 'on' : ''}
              aria-pressed={editing}
              onClick={() => editing || editor.open(text)}
            >
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

      {notice ? (
        <p className="sub sub-wide rule-notice" role="status">
          {notice}
        </p>
      ) : null}

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
        <>
          {/* The seeded stub reads like a profile; say first that nobody has written it. */}
          {data?.seeded ? (
            <EmptyState title="This is still the template">
              Ask the agent to run the <code className="mono">profile</code> skill — it interviews
              you and drafts this file with your consent.
            </EmptyState>
          ) : null}
          <div className="card pad-lg">
            <Markdown body={text} />
          </div>
        </>
      ) : (
        <EmptyState title="No profile yet">
          Switch to Edit to write one, or ask the agent to run the{' '}
          <code className="mono">profile</code> skill.
        </EmptyState>
      )}
    </section>
  )
}
