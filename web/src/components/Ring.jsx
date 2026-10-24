import React from 'react'

// A ring chart in plain SVG arcs: `segments` = [{ key, label, n, tone }], or a single
// `value` of `max`. The three cases a hand-rolled donut got wrong are the reason it is
// shared: at 0 % it draws only the empty track (no division by zero, no NaN path); a part
// that fills the whole ring is two half-arcs, because one SVG arc whose start is its end
// draws nothing (the blank all-pass doctor ring); anything else is one arc per part.
// The text alternative is the svg's own label, so the parts never read by colour alone.
//
// shortcut: no sweep-in yet; GreenhouseView's Donut has one (svg.createDrawable + settle),
// bring it across when a page adopts this ring.
export default function Ring({ segments, value, max, size = 120, stroke = 12, label }) {
  const cap = max > 0 ? max : 0
  const parts = segments || [
    { key: 'v', label, n: Math.min(Math.max(value || 0, 0), cap), tone: 'accent' },
  ]
  const total = segments ? parts.reduce((s, p) => s + p.n, 0) : cap
  const summary = segments
    ? parts.map((p) => `${p.label}: ${p.n} of ${total}`).join(', ')
    : `${parts[0].n} of ${total}`
  const r = size / 2 - stroke / 2
  const c = size / 2
  const at = (a) => [c + r * Math.cos(a), c + r * Math.sin(a)]
  // Each part's running start, computed before the JSX (react-hooks/immutability).
  const starts = []
  let acc = 0
  for (const p of parts) {
    starts.push(acc)
    acc += p.n
  }
  return (
    <svg
      className="ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label ? `${label}: ${summary}` : summary}
    >
      <circle className="ring-track" cx={c} cy={c} r={r} fill="none" strokeWidth={stroke} />
      {total > 0
        ? parts.map((p, i) => {
            const frac = p.n / total
            if (!(frac > 0)) return null
            const start = (starts[i] / total) * 2 * Math.PI - Math.PI / 2
            const end = start + frac * 2 * Math.PI
            const [x1, y1] = at(start)
            const [x2, y2] = at(end)
            const d =
              frac >= 0.9999
                ? `M ${x1} ${y1} A ${r} ${r} 0 1 1 ${2 * c - x1} ${2 * c - y1} A ${r} ${r} 0 1 1 ${x1} ${y1}`
                : `M ${x1} ${y1} A ${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${x2} ${y2}`
            return (
              <path
                key={p.key}
                className={`ring-arc tone-${p.tone || 'muted'}`}
                d={d}
                fill="none"
                strokeWidth={stroke}
              >
                <title>
                  {p.label}: {p.n}
                </title>
              </path>
            )
          })
        : null}
    </svg>
  )
}
