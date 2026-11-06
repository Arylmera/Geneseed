import React from 'react'
import { installTag } from '../lib/hosts.js'

// The install ONE entry, form or page acts on, placed beside it and labelled for it ("Write to:",
// "Checks for:"). There is no console-wide install: each picker speaks for its own spot only.
// With one active install there is nothing to pick, so it renders nothing. `tagOf` names an
// option, for a page where an install stands for something wider (the shared files).
export default function InstallPicker({
  installs,
  value,
  onChange,
  label,
  className = '',
  tagOf = installTag,
}) {
  if (!value || !installs || installs.length < 2) return null
  return (
    <label className={`install-pick ${className}`.trim()}>
      <span className="dim">{label}</span>
      <select
        className="sel mono"
        aria-label={label}
        value={value.id}
        onChange={(e) => onChange(installs.find((i) => i.id === e.target.value))}
      >
        {installs.map((i) => (
          <option key={i.id} value={i.id}>
            {tagOf(i)}
          </option>
        ))}
      </select>
    </label>
  )
}

// The one line the console shows when /api/installs could not be read: every page then reads
// the default install and offers no picker, so say so rather than look like a one-install machine.
export function InstallListStatus({ unreadable }) {
  if (!unreadable) return null
  return (
    <p className="sub rule-notice" role="status">
      Install list unreadable — showing the default install.
    </p>
  )
}
