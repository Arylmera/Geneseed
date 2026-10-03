import React from 'react'

// A <select> in the app's `.sel` style, shared by every picker on the Hosts tab — voice,
// footprint, posture and mode were four near-identical components differing only in
// their option list. Renders nothing until that list is non-empty: voice/posture/mode
// are discovered server-side and start empty, where footprint's fixed lean/full pair
// (FOOTPRINT_OPTIONS below) never is.
export function Sel({ label, value, options, onChange }) {
  if (!options.length) return null
  return (
    <select
      className="sel"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}

export const FOOTPRINT_OPTIONS = ['full', 'lean']

// An on/off switch — deactivates a whole install (files moved aside, not deleted) or
// reactivates it; also drives individual MCP servers. The on-disk stash is the truth.
//
// A native checkbox: Space toggles for free, and `disabled` alone now blocks every input
// (click, Space, tab focus) instead of the old div's hand-rolled aria-disabled + tabIndex
// + conditional handlers. Enter is the one behaviour the platform does NOT give a
// checkbox (it activates a nearby submit button, never this one), so it keeps the single
// keydown handler the old code had for it.
export function Switch({ on, disabled, label, onToggle }) {
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !disabled) onToggle()
  }
  return (
    <input
      type="checkbox"
      role="switch"
      className={`sw-toggle${on ? ' on' : ''}`}
      checked={on}
      aria-checked={on}
      disabled={disabled}
      aria-label={label}
      onChange={onToggle}
      onKeyDown={onKeyDown}
    />
  )
}

// The five build choices every install carries, in the order the install consumes them.
// `name` is the accessible label's first word, `title` the visible one.
const PICKS = [
  { key: 'theme', name: 'voice', title: 'Voice' },
  { key: 'footprint', name: 'footprint', title: 'Footprint' },
  { key: 'posture', name: 'posture', title: 'Posture' },
  { key: 'mode', name: 'mode', title: 'Mode' },
  { key: 'trust', name: 'trust', title: 'Loop trust' },
]

// The five selects, each in its own label: the install side panel and the deploy-to-folder
// form both lay them out this way. `value` is { theme, footprint, posture, mode, trust };
// `options` the same keys -> option lists; `who` finishes each accessible label ("voice for
// claude · global").
export function PickSelects({ value, options, onChange, who }) {
  return PICKS.map((p) => (
    <label className="dp-field" key={p.key}>
      <span>{p.title}</span>
      <Sel
        label={`${p.name} for ${who}`}
        value={value[p.key]}
        options={options[p.key]}
        onChange={(v) => onChange(p.key, v)}
      />
    </label>
  ))
}
