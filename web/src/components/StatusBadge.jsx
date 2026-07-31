import React from 'react'

// Lifecycle status for an agent or skill, from registry.json at the repo root and
// shipped by the catalog API as `status` (see _registry_problems in
// _harness_build.py, which gates the file against src/).
//
// `approved` renders NOTHING on purpose: it is the state of nearly every entity, so
// sixty-odd identical pills would be noise — the deviations are the whole signal.
// Reuses the house `.badge` styles, which every theme flavour already restyles.
const STATUS = {
  experimental: {
    label: 'experimental',
    cls: 'warn',
    hint: 'Shipped, but not yet confirmed by real use.',
  },
  deprecated: {
    label: 'deprecated',
    cls: 'bad',
    hint: 'On its way out — look for the replacement before building on it.',
  },
  unknown: {
    label: 'no status',
    cls: '',
    hint: 'Not listed in registry.json.',
  },
}

export default function StatusBadge({ status }) {
  const s = STATUS[status]
  if (!s) return null
  return (
    <span className={`badge ${s.cls}`} title={s.hint}>
      <span className="dot" />
      {s.label}
    </span>
  )
}
