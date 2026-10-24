import React, { useEffect, useState } from 'react'

const TOAST_DURATION_MS = 3500

// The console's one toast. An error ('err') stays until Dismiss: it is the toast a user most
// needs to read, and 3.5 s is less than a long message takes. Any other kind leaves after
// 3.5 s, but the clock stops while the pointer or focus is on it (WCAG 2.2.1) and restarts
// in full on the way out.
//
// The outer live region renders even with no toast, so a parent can keep this mounted: a
// live region that is inserted together with its message is often not announced at all.
export default function Toast({ toast, onClose }) {
  // Which toast is held, not a bare flag: Dismiss unmounts the toast under the pointer, its
  // mouseleave never fires, and a flag would hold every toast after it.
  const [heldFor, setHeldFor] = useState(null)
  const timed = !!toast && toast.kind !== 'err' && heldFor !== toast
  useEffect(() => {
    if (!timed) return
    const t = setTimeout(onClose, TOAST_DURATION_MS)
    return () => clearTimeout(t)
    // the dismiss timer is (re)armed per toast; onClose is intentionally omitted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, timed])
  const hold = () => setHeldFor(toast)
  const release = () => setHeldFor(null)
  return (
    // An error's only live semantics is its own role="alert": a polite region around an
    // alert makes some readers say it twice.
    <div className="toast-region" aria-live={toast?.kind === 'err' ? undefined : 'polite'}>
      {toast && (
        <div
          className={`toast ${toast.kind}`}
          role={toast.kind === 'err' ? 'alert' : undefined}
          onMouseEnter={hold}
          onMouseLeave={(e) => {
            if (!e.currentTarget.contains(document.activeElement)) release()
          }}
          onFocus={hold}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) release()
          }}
        >
          <div>{toast.msg}</div>
          <div style={{ marginTop: 8 }}>
            <button className="btn ghost" onClick={onClose}>
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
