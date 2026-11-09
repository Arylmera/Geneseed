import React, { useLayoutEffect, useRef, useState } from 'react'
import { backLabel, laneTaken, layoutFactory } from '../lib/factoryFlow.js'
import RingGraph, { HumanBadge } from './RingGraph.jsx'

const SLACK = 20 // px: more than a scrollbar's width

// A factory drawn as its stages, top to bottom (lib/factoryFlow.js does the geometry, spec D10):
// a brick as a grey block, a fork as an amber one, a `loop:` stage on the main path as a teal
// block holding its loop's ring (RingGraph, scaled), the lanes of a fork side by side as compact
// boxes (stacked as a list when the pane is narrow), `$close` and `$stop` as end caps, each route
// back as a rail on the left labelled with its cycle and `max`, and every stop edge into one rail
// on the right. When the pane has no room for rails, they become tags under the stage they leave.
// Every colour is a class in styles.css (`.fg-*`) reading the console's tokens.
//
// The graph never scrolls sideways (D18): it measures its own box, lays out for that width, and
// the svg is `width: 100%` capped at its layout width. Where the box cannot be measured (jsdom)
// the width is unbounded and the rails form is drawn.
//
// The svg is a named `group`, as RingGraph's is. A block is a button only when `onSelect(id)` is
// given, else a labelled image. A loop block's button is its title strip alone, never the ring:
// a button's children are presentational, so wrapping the ring would hide its nodes (LP-1).
// `highlight` names the stage a live run stands on (`.current`, `aria-current="step"`); `child`
// is that run's live loop (`{ graph, node }`), drawn in place of the template with its node lit.
// `lane` (the run's FACTORY.md `lane`) names the lane its last fork took (`.taken`); when the
// run carries none (undefined), `history` (its transitions) names it.
// `counters` (a run's cycle laps) turn a cycle's `max 2` into `1 / 2`.
export default function FactoryGraph({
  factory,
  bricks = [],
  loops = [],
  onSelect,
  highlight,
  child,
  counters,
  lane,
  history,
}) {
  const box = useRef(null)
  const [room, setRoom] = useState(0)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return undefined
    // Hysteresis: a change of the form changes the graph's height, which can show or hide the
    // pane's scrollbar (about 15 px), which changes this width, which could flip the form back.
    // A change of SLACK px or less is ignored: the svg (width 100%) scales down that little.
    const read = () =>
      setRoom((prev) => (Math.abs(el.clientWidth - prev) > SLACK ? el.clientWidth : prev))
    read()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const taken = lane !== undefined ? lane : laneTaken(factory, history)
  const l = layoutFactory(factory, bricks, { width: room, loops, lane: taken })
  const graphs = new Map(loops.map((t) => [t.name, t.graph]))
  const cycles = new Map((factory.cycles || []).map((c) => [c.name, c]))
  const forks = new Set(l.nodes.filter((n) => n.kind === 'fork').map((n) => n.id))
  const tagText = (t) =>
    t.kind === 'back'
      ? backLabel(cycles.get(t.cycle), counters)
      : `${t.on.join(' · ')} → ${t.kind === 'stop' ? 'stop' : t.to}`
  const label = (n) =>
    n.kind === 'loop'
      ? `${n.id} stage, the ${n.loop} loop`
      : `${n.id} ${n.kind === 'fork' ? 'fork' : 'brick'}${n.human ? `, ${n.human.toLowerCase()}` : ''}`
  const pick = (id) => (e) => {
    if (e.type === 'click' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect?.(id)
    }
  }
  const role = (n) => {
    const cur = n.id === highlight
    const said = `${label(n)}${n.id === taken ? ', the lane taken' : ''}`
    return onSelect
      ? {
          role: 'button',
          tabIndex: 0,
          'aria-label': said,
          onClick: pick(n.id),
          onKeyDown: pick(n.id),
        }
      : { role: 'img', 'aria-label': `${said}${cur ? ', current stage' : ''}` }
  }
  const cls = (n) =>
    `fg-node ${n.kind}${n.lane ? ' lane' : ''}${n.id === highlight ? ' current' : ''}${n.id === taken ? ' taken' : ''}`
  const takenEdge = (e) => taken && (e.to === taken || e.from === taken)
  const tags = (n) =>
    n.tags.map((t, i) => (
      <text
        key={`${t.kind}${t.to}`}
        x={n.x + n.w / 2 + 6}
        y={n.y + n.h + 12 + i * 15}
        className={`fg-lbl fg-tag ${t.kind}`}
      >
        {tagText(t)}
      </text>
    ))
  const legend = [
    ['brick', 'brick'],
    ['loop', 'whole loop (test · fix · verify)'],
    ['fork', 'fork'],
    ['back', 'route back, bounded by its max'],
    ['stop', 'fail → stop'],
  ]

  return (
    <div className="fg-wrap" ref={box}>
      <svg
        className="fgraph"
        data-mode={`${l.mode}${l.stacked ? ' stacked' : ''}`}
        style={{ '--fg-w': `${l.width}px` }}
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
          if (!e.path) return null
          const mark = e.kind === 'skip' ? 'flow' : e.kind
          const text = e.back
            ? backLabel(cycles.get(e.cycle), counters)
            : e.kind === 'flow' && e.plain
              ? ''
              : e.on.join(' · ')
          return (
            <g key={`${e.from}>${e.to}`}>
              <path
                d={e.path}
                className={`fg-edge ${e.kind}${takenEdge(e) && e.kind === 'flow' ? ' taken' : ''}`}
                markerEnd={`url(#fg-arrow-${mark})`}
              />
              {text ? (
                <text
                  x={e.lx}
                  y={e.ly}
                  textAnchor={e.anchor}
                  className={`fg-lbl ${e.kind}${e.kind === 'flow' && forks.has(e.from) ? ' fork' : ''}`}
                >
                  {text}
                </text>
              ) : null}
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
          const aria = n.id === highlight ? 'step' : undefined
          if (n.lane || n.kind === 'brick' || n.kind === 'fork') {
            const live = child && n.id === highlight ? child : null
            const sub = n.lane
              ? live
                ? `at ${live.node}`
                : n.kind === 'loop'
                  ? 'whole loop'
                  : 'no loop'
              : null
            return (
              <g key={n.id}>
                <g className={cls(n)} aria-current={aria} {...role(n)}>
                  {/* A lane box is narrow: it names its loop without the `loop:` prefix; the full
                      stage name stays in its aria-label and its hover title. */}
                  {n.lane ? <title>{n.id}</title> : null}
                  <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="10" />
                  <text x={n.x + n.w / 2} y={n.y + n.h / 2 + (sub ? -2 : 4)} textAnchor="middle">
                    {n.lane && n.loop ? n.loop : n.id}
                  </text>
                  {sub ? (
                    <text
                      x={n.x + n.w / 2}
                      y={n.y + n.h / 2 + 14}
                      textAnchor="middle"
                      className="fg-sub"
                    >
                      {sub}
                    </text>
                  ) : null}
                  {n.human ? <HumanBadge x={n.x + n.w - 4} y={n.y + 4} label={n.human} /> : null}
                </g>
                {tags(n)}
              </g>
            )
          }
          const live = child && n.id === highlight ? child : null
          const graph = live?.graph || (n.loop ? graphs.get(n.loop) : null)
          return (
            <g key={n.id}>
              <g className={cls(n)} aria-current={aria} {...role(n)}>
                <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="14" />
                <text x={n.x + 12} y={n.y + 20} className="fg-title">
                  {n.id}
                </text>
              </g>
              {graph ? (
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
              {tags(n)}
            </g>
          )
        })}
      </svg>
      <ul className="fg-legend" aria-label="Graph legend">
        {legend.map(([k, t]) => (
          <li key={k}>
            <span className={`fg-key ${k}`} aria-hidden="true" />
            {t}
          </li>
        ))}
      </ul>
    </div>
  )
}
