import React, { useLayoutEffect, useRef } from 'react'
import { animate, utils } from 'animejs'
import { motionOK, settle } from '../lib/motion.js'

const SWEEP_MS = 500

// A proportional bar of parts, `parts` = [{ key, label, n, tone }] with tone one of good,
// warn, bad, accent, muted. The hand-rolled `.stackbar`s on the pages were aria-hidden and
// told their parts apart by colour alone; here the bar is one image whose label reads every
// part ("label: n of total"), each segment carries a title, and the legend under it prints
// each label beside its count. `total` defaults to the sum; pass it when the parts are a
// share of something larger. `legend={false}` drops the legend where the caller already
// prints the label and count beside the bar.
//
// The bar sweeps in from the left on arrival and when its numbers change. The widths are
// final in the markup: without motion (reduced motion, a test) the bar is simply there.
export default function StackBar({ parts, total, label, legend = true }) {
  const sum = parts.reduce((s, p) => s + p.n, 0)
  const whole = total ?? sum
  const pct = (n) => (whole > 0 ? `${(n / whole) * 100}%` : '0%')
  const summary = parts.map((p) => `${p.label}: ${p.n} of ${whole}`).join(', ')
  const bar = useRef(null)
  const sig = parts.map((p) => p.n).join(',') + `/${whole}`
  useLayoutEffect(() => {
    if (!bar.current || !motionOK()) return
    // Collapsed before paint (a layout effect), so the full bar never flashes first.
    utils.set(bar.current, { scaleX: 0 })
    return settle(
      animate(bar.current, { scaleX: [0, 1], duration: SWEEP_MS, ease: 'outExpo' }),
      SWEEP_MS,
    )
  }, [sig])
  return (
    <div className="stackbar-box">
      <div
        className="stackbar sweep"
        role="img"
        aria-label={label ? `${label}: ${summary}` : summary}
        ref={bar}
      >
        {parts.map((p) =>
          p.n > 0 ? (
            <span
              key={p.key}
              className={`tone-${p.tone || 'muted'}`}
              style={{ width: pct(p.n) }}
              title={`${p.label}: ${p.n}`}
            />
          ) : null,
        )}
      </div>
      {legend && (
        <ul className="stackbar-legend" aria-hidden="true">
          {parts.map((p) => (
            <li key={p.key}>
              <i className={`tone-${p.tone || 'muted'}`} />
              {p.label} <span className="mono">{p.n}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// The one-part case: `value` of `max`, the rest left as empty track. Clamped to [0, max]
// like Ring, so an overshoot never draws a bar wider than its track. No legend: a one-part
// legend only repeats the label and the count every caller already prints beside the bar.
export function Bar({ value, max, label = 'value', tone = 'accent' }) {
  const cap = max > 0 ? max : 0
  const n = Math.min(Math.max(value || 0, 0), cap)
  return <StackBar parts={[{ key: 'v', label, n, tone }]} total={cap} legend={false} />
}
