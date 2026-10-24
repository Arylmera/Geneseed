import React, { useEffect, useId, useRef } from 'react'

// A themed confirm, replacing `window.confirm` where the browser chrome's own
// dialog broke the console's look. Native <dialog> on purpose: showModal() gives
// focus trapping, Esc-to-cancel and a ::backdrop for free — no library, no focus
// bookkeeping of our own. The element stays mounted and open/close is driven by
// the `open` prop, because showModal() can only be called on a dialog that is in
// the document.
//
// `tone: 'danger'` is for a question whose Confirm destroys something: the button turns
// red and focus starts on Cancel, so a reflex Enter is the safe answer.
export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone,
  onConfirm,
  onClose,
}) {
  const ref = useRef(null)
  const cancelRef = useRef(null)
  const confirmRef = useRef(null)
  const id = useId()
  const danger = tone === 'danger'
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      // jsdom lacks showModal/close — the attribute fallbacks keep tests rendering.
      if (typeof d.showModal === 'function') d.showModal()
      else d.setAttribute('open', '')
    }
    // Focused by hand, after the dialog is open: React's autoFocus fires once at mount,
    // while the dialog is still closed, so it never landed on the button at all. Outside the
    // branch above, so a danger question superseding an open plain one moves focus too.
    if (open) (danger ? cancelRef : confirmRef).current?.focus()
    if (!open && d.open) {
      if (typeof d.close === 'function') d.close()
      else d.removeAttribute('open')
    }
  }, [open, danger])
  return (
    // onCancel covers Esc; onClose covers every way the dialog shuts, so the
    // parent's `open` state can never disagree with the element's.
    <dialog
      ref={ref}
      className="confirm"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      onCancel={onClose}
      onClose={onClose}
    >
      <h3 className="confirm-title" id={`${id}-title`}>
        {title}
      </h3>
      <div className="confirm-body" id={`${id}-body`}>
        {children}
      </div>
      <div className="confirm-actions">
        <button type="button" className="btn ghost" onClick={onClose} ref={cancelRef}>
          Cancel
        </button>
        <button
          type="button"
          className={danger ? 'btn danger' : 'btn'}
          onClick={onConfirm}
          ref={confirmRef}
        >
          {confirmLabel || 'Confirm'}
        </button>
      </div>
    </dialog>
  )
}
