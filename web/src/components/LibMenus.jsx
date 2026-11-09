import React, { useEffect, useId, useRef, useState } from 'react'
import Popover from './Popover.jsx'

// The stacked Library's two menus (user, 2026-11-09): styles.css shows them only under the
// `lib` container tier, where they stand in for the rail. Section ▾ lists the page's sections
// as links (a place: aria-current), Category ▾ the open section's groups as toggles over the
// list (aria-pressed), "All" first with the total, and is left out for one group or none, as
// RailCats is. `sections`: [{ key, label, n, href, on }]; `cats`: RailCats' groups.
export default function LibMenus({ sections, cats, cat, total, onCat }) {
  const sec = sections.find((s) => s.on)
  const rows =
    cats?.length > 1 ? [{ key: 'all', label: 'All', n: total, c: 'var(--text-3)' }, ...cats] : null
  const cur = rows?.find((r) => r.key === cat) || rows?.[0]
  return (
    <div className="lib-menus">
      <MenuButton name="Section" value={sec?.label} n={sec?.n}>
        {(close) =>
          sections.map((s) => (
            <a
              key={s.key}
              href={s.href}
              className={s.on ? 'on' : ''}
              aria-current={s.on ? 'page' : undefined}
              onClick={close}
            >
              {s.label}
              <span className="mono dim">{s.n ?? ''}</span>
            </a>
          ))
        }
      </MenuButton>
      {rows && (
        <MenuButton name="Category" value={cur.label} n={cur.n}>
          {(close) =>
            rows.map((r) => (
              <button
                key={r.key}
                type="button"
                className={r.key === cur.key ? 'on' : ''}
                aria-pressed={r.key === cur.key}
                style={{ '--cc': r.c }}
                onClick={() => {
                  onCat(r.key)
                  close()
                }}
              >
                <span className="cdot" aria-hidden="true" />
                {r.label}
                <span className="mono dim">{r.n}</span>
              </button>
            ))
          }
        </MenuButton>
      )}
    </div>
  )
}

// A trigger saying its current value, over a Popover holding the options (Escape, a click
// outside, a pick and Tab out of it close it; focus goes back to the trigger). It opens on the
// current option; the arrow keys walk the options. `aria-controls` names the menu only while
// it exists.
function MenuButton({ name, value, n, children }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const id = useId()
  const close = () => setOpen(false)
  // After the Popover's own effect (a child's runs first), which focused the first option.
  useEffect(() => {
    if (open) document.getElementById(id)?.querySelector('.on')?.focus()
  }, [open, id])
  const leave = (e) => {
    const to = e.relatedTarget
    if (!to || (!e.currentTarget.contains(to) && to !== ref.current)) close()
  }
  const walk = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const opts = [...e.currentTarget.querySelectorAll('a, button')]
    const i = opts.indexOf(document.activeElement)
    const next = opts[(i + (e.key === 'ArrowDown' ? 1 : opts.length - 1)) % opts.length]
    e.preventDefault()
    next?.focus()
  }
  return (
    <span className="lib-menu">
      <button
        ref={ref}
        type="button"
        className="lib-menu-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="dim">{name}</span>
        <b>{value}</b>
        <span className="mono dim">{n ?? ''}</span>
        <span className="lib-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      <Popover open={open} onClose={close} anchorRef={ref} label={name} className="lib-menu-pop">
        <div id={id} className="lib-menu-list" onKeyDown={walk} onBlur={leave}>
          {children(close)}
        </div>
      </Popover>
    </span>
  )
}
