import React, { useEffect, useRef } from 'react'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// The popover the two topbar menus (Appearance, Voice) each wrote for themselves, with the
// keyboard half they were missing. On open, focus moves to the first focusable inside (or
// the box itself); Escape, a mousedown outside and Tab out of it close it; on close, focus goes back to the
// trigger (`anchorRef`) when it was inside, so a keyboard user is not dropped on <body>.
// A mousedown on the trigger is not "outside": the trigger's own click toggles it, and
// closing here first would make that click reopen it. Positioning is the caller's
// (`className`); the layer is --z-pop, which only lifts it above the drawer when it is not
// nested in another stacking context (the sticky topbar is one).
export default function Popover({ open, onClose, anchorRef, label, className, children }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const box = ref.current
    const anchor = anchorRef?.current
    ;(box.querySelector(FOCUSABLE) || box).focus()
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e) => {
      if (box.contains(e.target) || anchor?.contains(e.target)) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      // By now the box is gone, so focus that was in it sits on <body>.
      const a = document.activeElement
      if (!a || a === document.body || box.contains(a)) anchor?.focus()
    }
    // Armed per open; onClose is intentionally omitted — an inline callback would re-run
    // this on every render and pull focus back to the first item each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  if (!open) return null
  // Focus that leaves for the page closes it. Focus that goes nowhere (null) is left to the
  // mousedown rule: on Safari and on Firefox for macOS a click on an item moves focus there, or to
  // the box, before the click lands, and closing here would lose the pick. Back to the trigger is
  // not leaving: its own click toggles.
  const leave = (e) => {
    const to = e.relatedTarget
    if (!to || ref.current?.contains(to) || anchorRef?.current?.contains(to)) return
    onClose()
  }
  return (
    <div
      ref={ref}
      className={className ? `popover ${className}` : 'popover'}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      onBlur={leave}
    >
      {children}
    </div>
  )
}
