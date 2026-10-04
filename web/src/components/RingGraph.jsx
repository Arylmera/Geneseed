import React from 'react'
import { ENTRY_TO, layoutLoop } from '../lib/loopRing.js'

// A `gate: human` brick's marker: a small person badge (not the validate gate's filled ⛨
// shield), centred at (x, y), its title saying when the user is asked.
function HumanBadge({ x, y, label }) {
  return (
    <g className="lr-human">
      <title>{label}</title>
      <circle cx={x} cy={y} r="9" />
      <circle cx={x} cy={y - 2.4} r="2.6" className="lr-human-fig" />
      <path d={`M${x - 4.6},${y + 5.6} a4.6,4.6 0 0 1 9.2,0 Z`} className="lr-human-fig" />
    </g>
  )
}

// A loop template drawn as its ring (lib/loopRing.js does the geometry): the iteration as
// the big clockwise turn, inner retries hung on their head, the ⛨ validate gate the engine
// inserts before the first mutate step, setup entering from the left and `done → close`
// leaving from the head. A `gate: human` brick wears a person badge (HumanBadge) — on its node,
// or beside its setup label. Every colour is a class in styles.css (`.lr-*`) reading the
// console's tokens, so light mode and every accent retint it with no code here.
//
// A node is a button: `onSelect(name)` is the page scrolling to that brick's card.
// `highlight` names the node a live loop stands on (Loops › Active); it is drawn `.current`.
export default function RingGraph({ graph, bricks, onSelect, highlight }) {
  const l = layoutLoop(graph, bricks)
  const it = (graph.loops || []).find((x) => x.iteration)
  const pick = (name) => (e) => {
    if (e.type === 'click' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect?.(name)
    }
  }
  return (
    <svg
      className="loop-ring"
      viewBox={`0 0 ${l.width} ${l.height}`}
      role="img"
      aria-label={`${graph.name} loop: ${graph.nodes.join(', ')}`}
    >
      <defs>
        {['ring', 'inner', 'flow'].map((k) => (
          <marker
            key={k}
            id={`lr-arrow-${k}`}
            markerWidth="10"
            markerHeight="10"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 Z" className={`lr-head-${k}`} />
          </marker>
        ))}
      </defs>

      {l.mode === 'ring' &&
        l.inner.map((c) => (
          <g key={c.loop}>
            <circle cx={c.cx} cy={c.cy} r={c.r} className="lr-inner" />
            <text x={c.lx} y={c.ly} textAnchor={c.anchor} className="lr-sub lr-good">
              {c.label}
            </text>
          </g>
        ))}
      {l.mode === 'flow' &&
        l.inner.map((c) => (
          <g key={c.loop}>
            <rect
              x={c.box.x}
              y={c.box.y}
              width={c.box.w}
              height={c.box.h}
              rx="14"
              className="lr-box"
            />
            <text x={c.box.x + 10} y={c.box.y - 6} className="lr-sub lr-good">
              {c.label}
            </text>
          </g>
        ))}

      {l.arcs.map((a, i) => (
        <path key={i} d={a.d} className={`lr-${a.kind}`} markerEnd={`url(#lr-arrow-${a.kind})`} />
      ))}

      {l.entry.length > 0 && (
        <g>
          <path
            d={`M40,${l.entry.at(-1).y} L${ENTRY_TO},${l.entry.at(-1).y}`}
            className="lr-flow"
            markerEnd="url(#lr-arrow-flow)"
          />
          {l.entry.map((e) => (
            <g key={e.name}>
              <text x={e.x} y={e.y - 10} className="lr-lbl">
                {e.name}
              </text>
              <text x={e.x} y={e.y + 18} className="lr-sub">
                setup · 1×
              </text>
              {e.human ? <HumanBadge x={e.x - 14} y={e.y - 14} label={e.human} /> : null}
            </g>
          ))}
        </g>
      )}

      {l.nodes.map((n) =>
        n.gate ? (
          <g key={n.name} className="lr-gate">
            <title>validate — the engine scores the change before the first mutate step</title>
            <circle cx={n.x} cy={n.y} r={n.r} />
            <text x={n.x} y={n.y + 5} textAnchor="middle">
              ⛨
            </text>
            <text x={n.x + 20} y={n.y - 10} className="lr-sub lr-warn">
              validate
            </text>
          </g>
        ) : (
          <g
            key={n.name}
            className={`lr-node${n.inner ? ' inner' : ''}${n.effect === 'mutate' ? ' mutate' : ''}${n.name === highlight ? ' current' : ''}`}
            aria-current={n.name === highlight ? 'step' : undefined}
            role="button"
            tabIndex={0}
            aria-label={`${n.name} brick${n.human ? `, ${n.human.toLowerCase()}` : ''}`}
            onClick={pick(n.name)}
            onKeyDown={pick(n.name)}
          >
            <circle cx={n.x} cy={n.y} r={n.r} />
            <text x={n.x} y={n.y + 4} textAnchor="middle">
              {n.name}
            </text>
            {n.human ? (
              <HumanBadge x={n.x + n.r * 0.74} y={n.y - n.r * 0.74} label={n.human} />
            ) : null}
          </g>
        ),
      )}

      {l.exit && (
        <g>
          <path d={l.exit.d} className="lr-flow" markerEnd="url(#lr-arrow-flow)" />
          <text x={l.exit.x + 6} y={l.exit.y + 4} className="lr-lbl">
            close
          </text>
          <text x={l.exit.x - 90} y={l.exit.y - 10} textAnchor="middle" className="lr-sub">
            done
          </text>
        </g>
      )}

      {l.center && it && (
        <g>
          <text x={l.center.x} y={l.center.y - 4} textAnchor="middle" className="lr-title">
            {graph.name}
          </text>
          <text x={l.center.x} y={l.center.y + 16} textAnchor="middle" className="lr-sub lr-acc">
            iterations · max {it.max}
          </text>
        </g>
      )}
    </svg>
  )
}
