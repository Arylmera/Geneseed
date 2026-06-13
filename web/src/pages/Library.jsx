import React from 'react'
import { go } from '../lib/router.js'
import { Icon } from '../components/Icon.jsx'
import { SECTIONS, SECTION_ORDER } from '../lib/sections.js'

// Library landing — the web mirror of the TUI's Library submenu. Same 7 sections,
// same vocabulary, each card drills into the existing Section page. Visually it
// reuses the dashboard's "capability genome" cells (.gcell) so the look is
// consistent with the rest of the console.
export default function Library({ overview }) {
  const counts = overview?.counts || {}
  return (
    <>
      <div className="head-row mb-18">
        <div>
          <span className="eyebrow">browse</span>
          <h1 className="h">Library</h1>
          <p className="sub">
            Agents, skills, laws, memory, notebook, wiki, config — every rendered
            piece of the deployed harness, grouped by section.
          </p>
        </div>
      </div>
      <div className="genome">
        {SECTION_ORDER.map((key, i) => {
          const m = SECTIONS[key]
          return (
            <div
              className="card gcell rise"
              key={key}
              style={{ animationDelay: `${i * 50}ms` }}
              onClick={() => go('#/section/' + key)}
            >
              <div className="gtop">
                <span className="gname">{m.label}</span>
                <Icon name={m.icon} className="gicon" />
              </div>
              <div className="gcount">{counts[key] ?? '—'}</div>
              <div className="gdesc">{m.desc}</div>
            </div>
          )
        })}
      </div>
    </>
  )
}
