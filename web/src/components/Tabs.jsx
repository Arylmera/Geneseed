import React from 'react'
import { TABS, TAB_LABELS } from '../lib/router.js'
import { useViewLevel } from '../hooks/useViewLevel.jsx'

// A page's tab strip. Each tab is a LINK (`#/<page>/<tab>`), not a stateful button: the
// tab is part of the address, so it survives a reload, can be bookmarked, and the old
// flat routes (`#/doctor`, `#/rules`...) land on it. Hence `aria-current` rather than
// the tablist pattern, which is for panels switched in place without navigating.
// A tab above the view level is left out, but the current one stays: the reader got there by an
// address, and a strip that hid their own tab would lose them.
// `badges` maps a tab id to what its label carries (a count, a word).
export default function Tabs({ page, current, badges = {}, label }) {
  const { canSee } = useViewLevel()
  return (
    <nav className="tabs" aria-label={label}>
      {TABS[page]
        .filter((t) => t === current || canSee(`tab:${page}/${t}`))
        .map((t) => (
          <a
            key={t}
            href={`#/${page}/${t}`}
            className={current === t ? 'on' : ''}
            aria-current={current === t ? 'page' : undefined}
          >
            {TAB_LABELS[t]}
            {badges[t] == null ? null : <span className="tab-badge">{badges[t]}</span>}
          </a>
        ))}
    </nav>
  )
}
