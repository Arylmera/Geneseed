import { useEffect, useRef, useState } from 'react'
import { go, registerNavigationGuard } from '../lib/router.js'
import { useConfirm } from './useConfirm.jsx'

// One draft editor over a file that something outside the console also writes (an agent
// session edits PROFILE.md and user-rules.md). Shared by Profile and Rules.
//
// The draft lives in its OWN state, never derived from `data`: a reload (after a refused
// save, or any refetch) replaces `data` and must not replace the text being typed.
// `draft === null` means "not editing"; `open(v)` also keeps a pristine copy, so `dirty`
// is "changed since opened", not "differs from disk".
//
// `save(send)` passes the fingerprint of the LATEST load — after a refused save the reload
// brings the new one, so Save again goes through. post() REJECTS a 409; there is no
// resolved `{ ok: false }` to branch on. It never closes the draft: a Rules delete or
// graduate goes through here too and must leave an open draft alone.
//
// While dirty, leaving asks. `beforeunload` covers a tab close or reload only — an in-app
// link is a hashchange, which it never sees, and the Personal tab switch unmounts the
// editor — so a navigation guard asks too (the router's contract: refuse first, ask, then
// `go(to)` on discard).
// The one discard question: the leave-guard, Profile's View and Rules' Cancel all ask it.
export const confirmDiscard = (confirm) =>
  confirm('Discard your unsaved edit?', {
    title: 'Unsaved edit',
    confirmLabel: 'Discard',
    tone: 'danger',
  })

const DEFAULT_CONFLICT = 'The file changed on disk — reloaded the fresh copy. Your draft is kept.'

export function useFileEditor({ data, reload }) {
  const confirm = useConfirm()
  const [draft, setDraft] = useState(null)
  const [pristine, setPristine] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const fingerprint = data?.fingerprint || ''
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(pristine)
  const asking = useRef(false)

  const open = (v) => {
    setDraft(v)
    setPristine(v)
  }
  const close = () => setDraft(null)
  // Close, asking first when there is something to lose. Resolves whether it closed.
  const discard = async () => {
    if (dirty && !(await confirmDiscard(confirm))) return false
    close()
    return true
  }

  useEffect(() => {
    if (!dirty) return undefined
    const onLeave = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onLeave)
    const off = registerNavigationGuard(({ to }) => {
      if (!asking.current) {
        asking.current = true
        confirmDiscard(confirm)
          .then((yes) => {
            if (!yes) return
            off()
            setDraft(null)
            go(to)
          })
          .finally(() => {
            asking.current = false
          })
      }
      return false
    })
    return () => {
      window.removeEventListener('beforeunload', onLeave)
      off()
    }
  }, [dirty, confirm])

  const save = async (send, { conflict } = {}) => {
    setBusy(true)
    setNotice('')
    try {
      return (await send(fingerprint)) || true
    } catch (e) {
      if (e.status === 409) {
        setNotice(conflict ?? DEFAULT_CONFLICT)
      } else setNotice(e.message)
      return undefined
    } finally {
      setBusy(false)
      reload() // every attempt: success, 409 or another failure all leave the disk copy in doubt
    }
  }

  return { draft, setDraft, open, close, discard, dirty, busy, notice, setNotice, save }
}
