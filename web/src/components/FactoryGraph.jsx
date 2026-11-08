import React from 'react'
import { layoutFactory } from '../lib/factoryFlow.js'
import RingGraph, { HumanBadge } from './RingGraph.jsx'

// A factory drawn as its stages, left to right (lib/factoryFlow.js does the geometry): a brick as
// a block, a `loop:` stage as a block holding its loop's ring (RingGraph, scaled), the triaged
// loop as a block naming its allowlist, `$close` and `$stop` as end caps, and each route back as
// an arc above the row, labelled with its cycle and `max`. Every colour is a class in styles.css
// (`.fg-*`) reading the console's tokens, so light mode and every accent retint it with no code.
//
// The svg is a named `group`, as RingGraph's is. A block is a button only when `onSelect(id)` is
// given, else a labelled image. A loop block's button is its title strip alone, never the ring:
// a button's children are presentational, so wrapping the ring would hide its nodes (LP-1).
// `highlight` names the stage a live run stands on (`.current`, `aria-current="step"`); `child`
// is that run's live loop (`{ graph, node }`), drawn in place of the template with its node lit.
// `counters` (a run's cycle laps) turn a cycle's `max 2` into `1 / 2`.
export default function FactoryGraph({
  factory,
  bricks = [],
  loops = [],
  onSelect,
  highlight,
  child,
  counters,
}) {
  const l = layoutFactory(factory, bricks)
  const graphs = new Map(loops.map((t) => [t.name, t.graph]))
  const cycleOf = (e) =>
    (factory.cycles || []).find((c) => c.nodes?.[0] === e.to && c.nodes.includes(e.from))
  const label = (n) =>
    n.kind === 'loop'
      ? `${n.id} stage, the ${n.loop} loop`
      : n.kind === 'triaged'
        ? `${n.id} stage, one of ${n.allow.join(', ') || 'no loop'}`
        : `${n.id} brick${n.human ? `, ${n.human.toLowerCase()}` : ''}`
  const pick = (id) => (e) => {
    if (e.type === 'click' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect?.(id)
    }
  }
  const role = (n) => {
    const cur = n.id === highlight
    return onSelect
      ? {
          role: 'button',
          tabIndex: 0,
          'aria-label': label(n),
          onClick: pick(n.id),
          onKeyDown: pick(n.id),
        }
      : { role: 'img', 'aria-label': `${label(n)}${cur ? ', current stage' : ''}` }
  }
  const cls = (n) => `fg-node ${n.kind}${n.id === highlight ? ' current' : ''}`
  return (
    <svg
      className="fgraph"
      viewBox={`0 0 ${l.width} ${l.height}`}
      role="group"
      aria-label={`${factory.name} factory: ${(factory.stages || []).join(', ')}`}
    >
      <defs>
        {['flow', 'back', 'stop'].map((k) => (
          <marker
            key={k}
            id={`fg-arrow-${k}`}
            markerWidth="10"
            markerHeight="10"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 Z" className={`fg-head-${k}`} />
          </marker>
        ))}
      </defs>

      {l.edges.map((e) => {
        const c = e.back ? cycleOf(e) : null
        const mark = e.kind === 'skip' ? 'flow' : e.kind
        const laps = c
          ? `${c.name} · ${counters ? `${counters[c.name] ?? 0} / ${c.max}` : `max ${c.max}`}`
          : ''
        return (
          <g key={`${e.from}>${e.to}`}>
            <path d={e.path} className={`fg-edge ${e.kind}`} markerEnd={`url(#fg-arrow-${mark})`} />
            <text
              x={e.lx}
              y={e.ly}
              textAnchor={e.kind === 'stop' ? 'start' : 'middle'}
              className={`fg-lbl${e.back ? ' back' : ''}`}
            >
              {e.on.join(' · ')}
              {laps ? ` — ${laps}` : ''}
            </text>
          </g>
        )
      })}

      {l.nodes.map((n) => {
        if (n.kind === 'close' || n.kind === 'stop') {
          return (
            <g key={n.id} className={`fg-${n.kind}`} role="img" aria-label={n.kind}>
              <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={n.h / 2} />
              <text x={n.x + n.w / 2} y={n.y + n.h / 2 + 4} textAnchor="middle">
                {n.kind}
              </text>
            </g>
          )
        }
        if (n.kind === 'brick') {
          return (
            <g
              key={n.id}
              className={cls(n)}
              aria-current={n.id === highlight ? 'step' : undefined}
              {...role(n)}
            >
              <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="10" />
              <text x={n.x + n.w / 2} y={n.y + n.h / 2 + 4} textAnchor="middle">
                {n.id}
              </text>
              {n.human ? <HumanBadge x={n.x + n.w - 4} y={n.y + 4} label={n.human} /> : null}
            </g>
          )
        }
        const live = child && n.id === highlight ? child : null
        const graph = live?.graph || (n.loop ? graphs.get(n.loop) : null)
        return (
          <g key={n.id}>
            <g
              className={cls(n)}
              aria-current={n.id === highlight ? 'step' : undefined}
              {...role(n)}
            >
              <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="14" />
              <text x={n.x + 12} y={n.y + 20} className="fg-title">
                {n.id}
              </text>
            </g>
            {n.kind === 'triaged' ? (
              <text x={n.x + 12} y={n.y + 46} className="fg-sub">
                <tspan>one of</tspan>
                {n.allow.map((a, i) => (
                  <tspan key={a} x={n.x + 12} dy={i ? 15 : 17} className="mono">
                    {a}
                  </tspan>
                ))}
              </text>
            ) : graph ? (
              <foreignObject x={n.x + 8} y={n.y + 28} width={n.w - 16} height={n.h - 34}>
                <div className="fg-ring">
                  <RingGraph graph={graph} bricks={bricks} highlight={live?.node} />
                </div>
              </foreignObject>
            ) : (
              <text x={n.x + 12} y={n.y + 48} className="fg-sub">
                not in this install&apos;s catalogue
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
