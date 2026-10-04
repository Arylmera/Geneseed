import React from 'react'

// "All" plus one chip per group, each with its count, narrowing a list to one group.
// Shared by the Library (skill classes, as a banner across the whole card) and the Docs
// (page sections, above the list) — same markup, classes and keyboard/ARIA either way, so
// a chip plugged in anywhere behaves and looks the same. Renders nothing for 0 or 1 group:
// a single chip can't narrow anything.
export default function ClassChips({ label, total, cats, cat, onChange }) {
  if (cats.length <= 1) return null
  return (
    <div className="skill-banner" role="group" aria-label={label}>
      <div className="skill-banner-row">
        <span className="skill-banner-label">{label}</span>
        <div className="skill-cats">
          <button
            type="button"
            className={`skill-cat${cat === 'all' ? ' on' : ''}`}
            aria-pressed={cat === 'all'}
            onClick={() => onChange('all')}
          >
            All <span className="cn">{total}</span>
          </button>
          {cats.map(({ key, label: cl, n, c }) => (
            <button
              type="button"
              key={key}
              className={`skill-cat${cat === key ? ' on' : ''}`}
              aria-pressed={cat === key}
              style={{ '--cc': c }}
              onClick={() => onChange(key)}
            >
              <span className="cdot" aria-hidden="true" />
              {cl} <span className="cn">{n}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="skill-mix" aria-hidden="true">
        {cats.map(({ key, n, c }) => (
          <span
            key={key}
            className={cat === 'all' || cat === key ? '' : 'dim'}
            style={{ '--cc': c, flexGrow: n }}
          />
        ))}
      </div>
    </div>
  )
}
