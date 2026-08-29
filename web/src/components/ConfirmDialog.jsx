import React, { useEffect, useRef } from 'react'

// A themed confirm, replacing `window.confirm` where the browser chrome's own
// dialog broke the console's look. Native <dialog> on purpose: showModal() gives
// focus trapping, Esc-to-cancel and a ::backdrop for free — no library, no focus
// bookkeeping of our own. The element stays mounted and open/close is driven by
// the `open` prop, because showModal() can only be called on a dialog that is in
// the document.
export default function ConfirmDialog({ open, title, children, confirmLabel, onConfirm, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      // Older jsdom lacks showModal — the attribute fallback keeps tests rendering.
      if (typeof d.showModal === 'function') d.showModal()
      else d.setAttribute('open', '')
    }
    if (!open && d.open) d.close()
  }, [open])
  return (
    // onCancel covers Esc; onClose covers every way the dialog shuts, so the
    // parent's `open` state can never disagree with the element's.
    <dialog ref={ref} className="confirm" onCancel={onClose} onClose={onClose}>
      <h3 className="confirm-title">{title}</h3>
      <div className="confirm-body">{children}</div>
      <div className="confirm-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn" onClick={onConfirm} autoFocus>
          {confirmLabel || 'Confirm'}
        </button>
      </div>
    </dialog>
  )
}
