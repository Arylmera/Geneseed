import React from 'react'

// One row of the sheet: what it is, with one line of help, its value, and its control.
export function Row({ k, kid, help, children, control }) {
  return (
    <div className="sheet-row">
      <span className="sheet-k">
        {kid ? <span id={kid}>{k}</span> : k}
        {help ? <span className="sheet-h sub">{help}</span> : null}
      </span>
      <div className="sheet-v">{children}</div>
      <div className="sheet-c">{control}</div>
    </div>
  )
}

export function Section({ id, title, head, className = '', children }) {
  return (
    <section
      id={`set-${id}`}
      className={`card pad-md sheet-sec ${className}`}
      aria-labelledby={`${id}-h`}
    >
      <div className="card-head">
        <h3 id={`${id}-h`}>{title}</h3>
        {head}
      </div>
      {children}
    </section>
  )
}
