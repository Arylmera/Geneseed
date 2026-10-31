import React from 'react'
import { TABS, TAB_LABELS } from '../lib/router.js'

// A page's tab strip. Each tab is a LINK (`#/<page>/<tab>`), not a stateful button: the
// tab is part of the address, so it survives a reload, can be bookmarked, and the old
// flat routes (`#/doctor`, `#/rules`...) land on it. Hence `aria-current` rather than
// the tablist pattern, which is for panels switched in place without navigating.
// `badges` maps a tab id to what its label carries (a count, a dot), or to `{ v, of }` when the
// figure is one install's among several: the badge then names it (tooltip and screen reader).
export default function Tabs({ page, current, badges = {}, label }) {
  return (
    <nav className="tabs" aria-label={label}>
      {TABS[page].map((t) => (
        <a
          key={t}
          href={`#/${page}/${t}`}
          className={current === t ? 'on' : ''}
          aria-current={current === t ? 'page' : undefined}
        >
          {TAB_LABELS[t]}
          {badges[t] == null ? null : badges[t]?.of ? (
            <span className="tab-badge" title={`for ${badges[t].of}`}>
              {badges[t].v}
              <span className="sr-only"> for {badges[t].of}</span>
            </span>
          ) : (
            <span className="tab-badge">{badges[t]?.v ?? badges[t]}</span>
          )}
        </a>
      ))}
    </nav>
  )
}
