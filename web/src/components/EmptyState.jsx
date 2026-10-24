import React from 'react'

// "Nothing here yet" that says what to do next. A bare "No items" is a dead end; the
// `action` (a node, usually one button) and the `docs` link ({ href, label }) are the two
// ways out a new user needs. Reuses `.empty`, so it looks like the empty states already on
// the pages.
export default function EmptyState({ title, children, action, docs }) {
  return (
    <div className="empty">
      {title ? <div className="big">{title}</div> : null}
      {children ? <div>{children}</div> : null}
      {action || docs ? (
        <div className="empty-actions">
          {action}
          {docs ? <a href={docs.href}>{docs.label}</a> : null}
        </div>
      ) : null}
    </div>
  )
}
