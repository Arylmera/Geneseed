import React from 'react'
import { useCountUp } from '../lib/motion.js'

// One headline number with its label, an optional `delta` (text, so a change never reads
// by colour alone) and a `children` slot for a sparkline. An integer counts up through
// useCountUp; anything else (a ratio, "—", a string) is shown as given, because rounding a
// 99.5 % up to 100 on the way would print a number that was never true.
export default function Stat({ label, value, delta, children }) {
  const n = useCountUp(Number.isInteger(value) ? value : null)
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value mono">{n === null ? value : Math.round(n)}</div>
      {delta != null ? <div className="stat-delta">{delta}</div> : null}
      {children}
    </div>
  )
}
