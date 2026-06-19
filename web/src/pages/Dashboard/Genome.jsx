import React from 'react'
import { go } from '../../lib/router.js'
import { Icon } from '../../components/Icon.jsx'
import { SECTIONS, SECTION_ORDER } from '../../lib/sections.js'

// The "capability genome": one clickable cell per section, showing its count.
export default function Genome({ overview }) {
  return (
    <div className="genome">
      {SECTION_ORDER.map((key, i) => {
        const m = SECTIONS[key]
        const n = overview.counts?.[key]
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
            <div className={'gcount' + (n === 0 ? ' zero' : '')}>{n ?? '—'}</div>
            <div className="gdesc">{m.desc}</div>
          </div>
        )
      })}
    </div>
  )
}
