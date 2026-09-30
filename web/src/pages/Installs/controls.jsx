import React from 'react'

// A <select> in the app's `.sel` style, shared by every picker on the Harness page — voice,
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

// The four build choices every install carries, in the order the install consumes them.
// `name` is the accessible label's first word, `lane` the active row's column class.
const PICKS = [
  { key: 'theme', name: 'voice', title: 'Voice', lane: 'ha-voice' },
  { key: 'footprint', name: 'footprint', title: 'Footprint', lane: 'ha-fp' },
  { key: 'posture', name: 'posture', title: 'Posture', lane: 'ha-posture' },
  { key: 'mode', name: 'mode', title: 'Mode', lane: 'ha-mode' },
]

// The four selects, in one of the three places they appear:
//   lanes — an active install row's first four fixed columns. The cells always render
//           (empty when `hidden`) so every row's controls line up.
//   steps — an absent row's install wizard, numbered in install order.
//   form  — the deploy-to-folder form.
// `value` is { theme, footprint, posture, mode }; `options` the same keys -> option lists;
// `who` finishes each label ("voice for claude · global").
export function PickSelects({ layout, value, options, onChange, who, hidden = false }) {
  return PICKS.map((p, i) => {
    const sel = hidden ? null : (
      <Sel
        label={`${p.name} for ${who}`}
        value={value[p.key]}
        options={options[p.key]}
        onChange={(v) => onChange(p.key, v)}
      />
    )
    if (layout === 'lanes')
      return (
        <div className={`ha-cell ${p.lane}`} key={p.key}>
          {sel}
        </div>
      )
    return (
      <label className={layout === 'steps' ? 'hs-step' : 'dp-field'} key={p.key}>
        <span>{layout === 'steps' ? `${i + 1} · ${p.title}` : p.title}</span>
        {sel}
      </label>
    )
  })
}
