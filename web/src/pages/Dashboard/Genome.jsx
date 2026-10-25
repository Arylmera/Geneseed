import React from 'react'
import { Icon } from '../../components/Icon.jsx'
import { SECTIONS, SECTION_ORDER } from '../../lib/sections.js'
import { CountUp } from '../../lib/motion.js'

// The "capability genome": one cell per section, showing its count. Each cell is a real <a>
// (the KpiStrip pattern), not a div with a click handler: it takes Tab and Enter, a screen
// reader lists it, and middle-click opens the section in a new tab.
export default function Genome({ overview }) {
  return (
    <div className="genome">
      {SECTION_ORDER.map((key, i) => {
        const m = SECTIONS[key]
        const n = overview.counts?.[key]
        return (
          <a className="card gcell rise" key={key} style={{ '--i': i }} href={'#/section/' + key}>
            <div className="gtop">
              <span className="gname">{m.label}</span>
              <Icon name={m.icon} className="gicon" />
            </div>
            <div className={'gcount' + (n === 0 ? ' zero' : '')}>
              {n == null ? '—' : <CountUp value={n} />}
            </div>
            <div className="gdesc">{m.desc}</div>
          </a>
        )
      })}
    </div>
  )
}
