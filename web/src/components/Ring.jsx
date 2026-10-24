import React, { useLayoutEffect, useRef } from 'react'
import { animate, svg, utils } from 'animejs'
import { motionOK, settle } from '../lib/motion.js'

// A ring chart in plain SVG arcs: `segments` = [{ key, label, n, tone }], or a single
// `value` of `max`. The three cases a hand-rolled donut got wrong are the reason it is
// shared: at 0 % it draws only the empty track (no division by zero, no NaN path); a part
// that fills the whole ring is two half-arcs, because one SVG arc whose start is its end
// draws nothing (the blank all-pass doctor ring); anything else is one arc per part.
// The text alternative is the svg's own label, so the parts never read by colour alone.
//
// The arcs SWEEP in, one after another clockwise, each taking its share of `sweepMs` — so
// the chart reads as one ring being filled, not as slices popping in. Keyed on the values,
// so a ring that arrives empty and fills later (the doctor's) sweeps again when they land.
export default function Ring({
  segments,
  value,
  max,
  size = 120,
  stroke = 12,
  label,
  sweepMs = 650,
}) {
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
  const arcs = useRef(null)
  const sig = parts.map((p) => p.n).join(',')
  useLayoutEffect(() => {
    const paths = arcs.current?.querySelectorAll('path.ring-arc')
    // `sweepMs={0}`: the caller drives the arc itself (a tween of its own), so no sweep.
    if (!sweepMs || !paths?.length || !motionOK()) return
    // The same parts the render draws (it skips `!(frac > 0)`), so index i is path i.
    const fr = parts.map((p) => p.n / total).filter((f) => f > 0)
    const from = fr.map((_, i) => fr.slice(0, i).reduce((a, b) => a + b, 0))
    const drawn = svg.createDrawable(paths)
    // Hidden BEFORE paint (this is a layout effect), not on the first animation frame —
    // otherwise the full ring flashes for one frame before the sweep starts.
    utils.set(drawn, { draw: '0 0' })
    const anim = animate(drawn, {
      draw: ['0 0', '0 1'],
      duration: (_, i) => Math.max(sweepMs * fr[i], 60),
      delay: (_, i) => sweepMs * from[i],
      ease: 'linear',
    })
    return settle(anim, sweepMs)
    // `sig` IS the parts' identity here; the array itself is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, sweepMs])
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
      <g ref={arcs}>
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
      </g>
    </svg>
  )
}
