import React from 'react'
import { useCountUp } from '../../lib/motion.js'

// The germination dial: a progress ring with a ticked bezel, filled to `value`
// (0..1). Pure presentation — the readiness number is computed upstream.
// ONE tween drives the arc, the bezel ticks and the number, so the three can never
// disagree mid-flight: the ticks light as the arc passes them, and the percentage reads
// what the arc shows. It used to be a CSS transition on the arc alone, under a number
// that had already jumped to its end.
export default function Ring({ value, size = 232 }) {
  const shown = useCountUp(value, 1100) ?? 0
  const r = size / 2 - 14
  const c = 2 * Math.PI * r
  const off = c * (1 - shown)
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth="10"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
        />
        {Array.from({ length: 48 }).map((_, i) => {
          const a = (i / 48) * 2 * Math.PI
          const inner = r - 18,
            outer = r - 24
          const x1 = size / 2 + Math.cos(a) * inner,
            y1 = size / 2 + Math.sin(a) * inner
          const x2 = size / 2 + Math.cos(a) * outer,
            y2 = size / 2 + Math.sin(a) * outer
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="var(--line-2)"
              strokeWidth="1"
              opacity={i / 48 < shown ? 0.9 : 0.25}
            />
          )
        })}
      </svg>
      <div className="ring-center">
        <div className="pct">
          {Math.round(shown * 100)}
          <span style={{ fontSize: 20, color: 'var(--text-3)' }}>%</span>
        </div>
        <div className="lbl">germination</div>
      </div>
    </div>
  )
}
