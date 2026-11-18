import React, { useEffect, useId, useRef, useState } from 'react'
import { pickerGroups, priceOf, tokens } from '../lib/models.js'

// The model picker (Models page): a modal list of the models the install can run, grouped by where
// they come from, with search, a first row for the session model and a last one for any id typed
// by hand. Native <dialog> like ConfirmDialog (focus trap, Esc, ::backdrop). The page decides what a
// choice means: `onPick('inherit')`, `onPick('<model id>')`; the picker only chooses.
//
// A model the host cannot use now stays listed but greyed, with the reason (the server's `reason`).
// A typed id is saved as written; a source that lists it is the only thing that makes it "detected".
export default function ModelPicker({ open, title, data, current, onPick, onClose }) {
  const ref = useRef(null)
  const id = useId()
  const [q, setQ] = useState('')
  // The page keys the picker on what it is picking, so each opening starts clean: no stale query, and
  // the custom field holds the current id.
  const [typed, setTyped] = useState(current && current !== 'inherit' ? current : '')

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal()
      else d.setAttribute('open', '')
    }
    if (!open && d.open) {
      if (typeof d.close === 'function') d.close()
      else d.removeAttribute('open')
    }
  }, [open])

  const groups = open ? pickerGroups(data, q) : []
  const custom = typed.trim()
  return (
    <dialog
      ref={ref}
      className="confirm model-picker"
      aria-labelledby={`${id}-title`}
      onCancel={onClose}
      onClose={onClose}
    >
      <h3 className="confirm-title" id={`${id}-title`}>
        {title}
      </h3>
      <input
        className="inp mp-search"
        type="search"
        aria-label="Search models"
        placeholder="Search models"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="mp-list">
        {groups.map((g) => (
          <section
            key={`${g.provider}|${g.source}|${g.note}`}
            className="mp-group"
            aria-label={g.providerName}
          >
            <header className="mp-head">
              <span className="mp-name">{g.providerName}</span>
              <span className="dim">{g.note}</span>
              {g.available === false ? (
                <span className="tag warn">{g.reason || 'unavailable'}</span>
              ) : null}
            </header>
            {g.rows.map((m) => (
              <button
                type="button"
                key={`${g.provider}|${m.id}`}
                className={`mp-row${m.id === current ? ' on' : ''}`}
                disabled={m.available === false}
                aria-pressed={m.id === current}
                onClick={() => onPick(m.id)}
                title={m.available === false ? m.reason : undefined}
              >
                <span className="mp-id">
                  {m.id === 'inherit' ? 'Session model (inherit)' : m.name !== m.id ? m.name : m.id}
                  {m.id !== 'inherit' && m.name !== m.id ? (
                    <span className="dim mono"> {m.id}</span>
                  ) : null}
                </span>
                <span className="mp-meta">
                  {m.id === 'inherit' ? null : (
                    <span className={`tag ${m.local ? 'ok' : ''}`}>
                      {m.local ? 'local' : 'remote'}
                    </span>
                  )}
                  {m.context ? <span className="tag">{tokens(m.context)} ctx</span> : null}
                  {m.cost ? <span className="tag">{priceOf(m.cost)}</span> : null}
                  {m.reasoning ? <span className="tag acc">reasoning</span> : null}
                  {m.variants?.length ? (
                    <span className="tag">variants: {m.variants.join(', ')}</span>
                  ) : null}
                  {m.detected === false ? <span className="tag warn">not detected</span> : null}
                  {m.available === false ? (
                    <span className="tag warn">{m.reason || 'unavailable'}</span>
                  ) : null}
                </span>
              </button>
            ))}
          </section>
        ))}
        {open && !groups.some((g) => g.rows.length) && q ? (
          <p className="sub">No model matches “{q}”.</p>
        ) : null}
      </div>
      <form
        className="mp-custom"
        onSubmit={(e) => {
          e.preventDefault()
          if (custom) onPick(custom)
        }}
      >
        <label className="mp-custom-label">
          <span className="dim">Custom…</span>
          <input
            className="inp"
            type="text"
            aria-label="Custom model id"
            placeholder="provider/model, or the id as the host knows it"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>
        <button type="submit" className="btn ghost sm" disabled={!custom}>
          Use this id
        </button>
      </form>
      <div className="confirm-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>
  )
}
