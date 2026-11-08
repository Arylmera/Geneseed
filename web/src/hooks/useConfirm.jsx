import React, { createContext, useCallback, useContext, useRef, useState } from 'react'
import ConfirmDialog from '../components/ConfirmDialog.jsx'

// `const confirm = useConfirm(); if (await confirm(msg, { title, confirmLabel, tone })) …`
// `tone: 'danger'` when Confirm destroys something (see ConfirmDialog).
// `check: { label, checked }` adds one checkbox: Confirm then resolves `{ checked }` (truthy, so
// a caller's `if (ok)` still reads it) and Cancel still resolves false.
//
// The themed replacement for `window.confirm`, whose browser chrome broke the console's
// look and froze the page's JS while it was open. App mounts ONE provider, inside the
// `.app` element — the dialog must sit under it to inherit the flavour's CSS variables
// (`.app.light` redefines them) — and every page asks through it.
//
// The context is exported so a test can hand a page a stub (`vi.fn(async () => true)`)
// and read the questions it asked, instead of clicking through the dialog each time.
export const ConfirmContext = createContext(null)

const missing = () => {
  throw new Error('useConfirm() needs a <ConfirmProvider> above it')
}

export function useConfirm() {
  return useContext(ConfirmContext) || missing
}

export function ConfirmProvider({ children }) {
  const [ask, setAsk] = useState(null) // { msg, title, confirmLabel, tone, check } while open
  const [checked, setChecked] = useState(false)
  // The pending promise's resolver lives in a ref, not in state: the dialog's `close`
  // event fires after an answer has already settled it, and must find nothing to settle.
  const resolveRef = useRef(null)
  const answer = (v) => {
    const r = resolveRef.current
    resolveRef.current = null
    setAsk(null)
    r?.(v)
  }
  const confirm = useCallback(
    (msg, opts = {}) =>
      new Promise((resolve) => {
        resolveRef.current?.(false) // a second question supersedes an unanswered one
        resolveRef.current = resolve
        setChecked(Boolean(opts.check?.checked))
        setAsk({ msg, ...opts })
      }),
    [],
  )
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={!!ask}
        title={ask?.title || 'Are you sure?'}
        confirmLabel={ask?.confirmLabel}
        tone={ask?.tone}
        onConfirm={() => answer(ask?.check ? { checked } : true)}
        onClose={() => answer(false)}
      >
        {ask?.msg}
        {ask?.check ? (
          <label className="confirm-check">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            {ask.check.label}
          </label>
        ) : null}
      </ConfirmDialog>
    </ConfirmContext.Provider>
  )
}
