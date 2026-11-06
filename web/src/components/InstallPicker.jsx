import React from 'react'
import { installTag } from '../lib/hosts.js'

// The install ONE page, form or popover acts on, always labelled "Install:". A page's sits right
// above the heading of the view it acts on, by `className="page-pick"`: under the tabs on a tabbed
// page, over the h1 on a page with none. A form or a
// popover that acts on an install of its own holds the same control inside it. There is no
// console-wide install: each picker speaks for its own spot only. With one active install there is
// nothing to pick, so it renders nothing. `tagOf` names an option, for a page where an install
// stands for something wider (the shared files).
export default function InstallPicker({
  installs,
  value,
  onChange,
  className = '',
  tagOf = installTag,
}) {
  if (!value || !installs || installs.length < 2) return null
  return (
    <label className={`install-pick ${className}`.trim()}>
      <span className="dim">Install:</span>
      <select
        className="sel mono"
        aria-label="Install"
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
