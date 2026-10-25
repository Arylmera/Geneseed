import React, { memo, useMemo } from 'react'
import { W, H } from '../../lib/garden.js'

// The parts of a pixel bonsai that the Garden and a session's detail page share: the tree
// SVG with its hoverable pads, the card a pad hover shows, and the Sakura preference.

const PAD_LIST = 12

export const SAKURA_KEY = 'geneseed-garden-sakura'
export function readSakura() {
  try {
    return window.localStorage.getItem(SAKURA_KEY) === '1'
  } catch {
    return false
  }
}

// The crown is the only pad without a key; every sub-agent pad has one (Bob's have no id).
const who = (pad) => (pad.key == null ? 'the session' : pad.type || 'agent')
const where = (f) => f.path || f.file || '?'

export function PadCard({ pad }) {
  const shown = pad.files.slice(0, PAD_LIST)
  return (
    <div className="card gd-card">
      <div className="act-lbl">
        {who(pad)} · {pad.files.length} file{pad.files.length === 1 ? '' : 's'}
      </div>
      <ul className="gd-files">
        {shown.map((f, i) => (
          <li key={`${where(f)}:${i}`}>
            <span className="mono act-ell">{where(f)}</span>
            <span className="mono act-xs">
              <span className="t-good">+{f.additions ?? 0}</span>{' '}
              <span className="t-bad">−{f.deletions ?? 0}</span>
            </span>
          </li>
        ))}
      </ul>
      {pad.files.length > shown.length && (
        <div className="dim act-xs">+{pad.files.length - shown.length} more</div>
      )}
    </div>
  )
}

// `t` is a gardenTree() drawing; `pad` the hovered pad's index, or null; `onPad(p)` reports a
// pad hover (null on leave) and must be stable, or the ~400 rects are rebuilt on every render.
// With `label` the SVG is an image with that text alternative, else it is hidden from
// screen readers (its owner labels it).
export const TreeSvg = memo(function TreeSvg({ t, pad, swaying, onPad, px, label }) {
  const groups = useMemo(() => {
    const by = new Map()
    for (const r of t.runs) {
      if (!by.has(r.p)) by.set(r.p, [])
      by.get(r.p).push(r)
    }
    return [...by.entries()]
  }, [t])
  return (
    <svg
      className={`gd-svg${pad != null ? ' gd-dimming' : ''}`}
      viewBox={`0 0 ${W} ${H}`}
      width={W * px}
      height={H * px}
      shapeRendering="crispEdges"
      data-bubble={t.bubble || undefined}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' })}
    >
      {groups.map(([p, runs]) => (
        <g
          key={p}
          data-p={p}
          className={
            [p === pad && 'gd-hot', swaying && p >= 0 && t.pads[p].key != null && 'gd-sway']
              .filter(Boolean)
              .join(' ') || undefined
          }
          onMouseEnter={p >= 0 ? () => onPad(p) : undefined}
          onMouseLeave={p >= 0 ? () => onPad(null) : undefined}
        >
          {runs.map((r) => (
            <rect key={`${r.x},${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.c} />
          ))}
        </g>
      ))}
    </svg>
  )
})
