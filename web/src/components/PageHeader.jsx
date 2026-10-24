import React from 'react'

// The one page head: every page used to hand-roll `.page-head` with its own idea of where
// the title, the subtitle and the buttons go. One h1 per page (the topbar crumbs are not a
// heading), `primary` is the single filled action and `actions` the secondary (ghost) ones,
// so a page cannot grow two competing primary buttons by accident. Both are nodes: the
// caller owns the buttons, this owns the order. `crumbs` is [{ label, href? }]; the last
// one is the current page.
export default function PageHeader({ eyebrow, title, sub, primary, actions, crumbs }) {
  return (
    <div className="page-head">
      <div>
        {crumbs?.length ? (
          <nav aria-label="Breadcrumb" className="page-crumbs">
            <ol>
              {crumbs.map((c, i) => (
                <li key={i}>
                  {i === crumbs.length - 1 ? (
                    <span aria-current="page">{c.label}</span>
                  ) : c.href ? (
                    <a href={c.href}>{c.label}</a>
                  ) : (
                    c.label
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1 className="h">{title}</h1>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      {primary || actions ? (
        <div className="page-actions">
          {actions}
          {primary}
        </div>
      ) : null}
    </div>
  )
}
