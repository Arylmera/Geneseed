import React, { useEffect, useId, useRef, useState } from 'react'
import Popover from './Popover.jsx'

// One of several choices as a compact button, "Used ▾", over a menu of the choices on the house
// Popover (the stacked Library toolbar's usage filter, where the counted Seg would repeat the
// totals). `options`: [{ key, label }]. The trigger is named "<label>: <choice>". Escape, a
// click outside, a pick and Tab out of the menu close it; focus goes back to the trigger. It
// opens on the current choice; the arrow keys walk the choices. `aria-controls` names the menu
// only while it exists.
export default function DropMenu({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const id = useId()
  const cur = options.find((o) => o.key === value) || options[0]
  const close = () => setOpen(false)
  // After the Popover's own effect (a child's runs first), which focused the first choice.
  useEffect(() => {
    if (open) document.getElementById(id)?.querySelector('[aria-pressed="true"]')?.focus()
  }, [open, id])
  const leave = (e) => {
    // Focus that goes nowhere (null) is left to the click-outside rule: on Safari and on
    // Firefox for macOS a click on a choice moves focus there, or to the popover box, before
    // the click lands, and closing here would lose the pick.
    const to = e.relatedTarget
    if (!to || to === ref.current || e.currentTarget.closest('.popover')?.contains(to)) return
    close()
  }
  const walk = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const opts = [...e.currentTarget.querySelectorAll('button')]
    const i = opts.indexOf(document.activeElement)
    e.preventDefault()
    opts[(i + (e.key === 'ArrowDown' ? 1 : opts.length - 1)) % opts.length]?.focus()
  }
  return (
    <span className="drop-menu">
      <button
        ref={ref}
        type="button"
        className="drop-menu-btn"
        aria-label={`${label}: ${cur.label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {cur.label}
        <span className="lib-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      <Popover open={open} onClose={close} anchorRef={ref} label={label} className="drop-menu-pop">
        <div id={id} className="drop-menu-list" onKeyDown={walk} onBlur={leave}>
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              aria-pressed={o.key === cur.key}
              onClick={() => {
                onChange(o.key)
                close()
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      </Popover>
    </span>
  )
}
