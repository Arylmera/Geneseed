import React from 'react'
import { Icon } from './Icon.jsx'

// Lifecycle status for an agent or skill, from registry.json at the repo root and
// shipped by the catalog API as `status` (doctor's registry check gates the
// file against src/).
//
// `approved` renders NOTHING on purpose: it is the state of nearly every entity, so
// sixty-odd identical pills would be noise — the deviations are the whole signal.
// Reuses the house `.badge` styles, which every theme flavour already restyles.
//
// `personal` (registry knows nothing about it) and `unknown` (registry unreadable, so
// nothing is known about anything) both mean "no lifecycle status", but only the first
// is a statement about the entity — hence two labels, not one.
const STATUS = {
  experimental: {
    label: 'experimental',
    cls: 'warn',
    icon: 'flask',
    hint: 'Shipped, but not yet confirmed by real use.',
  },
  deprecated: {
    label: 'deprecated',
    cls: 'bad',
    icon: 'clear',
    hint: 'On its way out — look for the replacement before building on it.',
  },
  personal: {
    label: 'personal',
    cls: '',
    icon: 'profile',
    hint: 'Yours — present in this install, not shipped or versioned by Geneseed.',
  },
  unknown: {
    label: 'no status',
    cls: '',
    icon: 'about',
    hint: 'Not listed in registry.json.',
  },
}

// `withHint` (the Library reader) also prints the hint as text: a `title` reaches neither the
// keyboard nor a touch screen (LB-14). Rows leave it off: a sentence per row is noise, and in
// LibRows it would join the row link's name. `compact` (the rows) is the icon alone, its label
// kept for a screen reader: a pill took the width of the name it sat beside. StatusLegend names
// the icons.
export default function StatusBadge({ status, withHint = false, compact = false }) {
  const s = STATUS[status]
  if (!s) return null
  if (compact) {
    return (
      <span className={`badge status-icon ${s.cls}`} title={`${s.label}: ${s.hint}`}>
        <Icon name={s.icon} />
        <span className="sr-only">{s.label}</span>
      </span>
    )
  }
  const badge = (
    <span className={`badge ${s.cls}`} title={withHint ? undefined : s.hint}>
      <span className="dot" />
      {s.label}
    </span>
  )
  if (!withHint) return badge
  return (
    <>
      {badge}
      <span className="dim">{s.hint}</span>
    </>
  )
}

// The key to the rows' icons: one entry per status the list holds, nothing for a list with none.
export function StatusLegend({ items }) {
  return Object.keys(STATUS)
    .filter((k) => items.some((it) => it.status === k))
    .map((k) => (
      <span key={k} title={STATUS[k].hint}>
        <span className={`badge status-icon ${STATUS[k].cls}`} aria-hidden="true">
          <Icon name={STATUS[k].icon} />
        </span>
        {STATUS[k].label}
      </span>
    ))
}
