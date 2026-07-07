import React from 'react'
import { Icon } from '../../components/Icon.jsx'
import { editCount } from '../../lib/format.js'
import { bucketJobsByDay } from '../../lib/jobBuckets.js'
import { SECTION_ORDER, SECTIONS } from '../../lib/sections.js'

// Recent-activity panel: how many jobs to list, and how much of each job's first
// output line to show as a preview.
const MAX_TIMELINE_JOBS = 12
const MAX_OUTPUT_PREVIEW = 120

// Greenhouse "category" palette — warm rich tones that survive on both the
// deep-forest dark and cream-paper light variants. Stable index per section
// so a colour assigned to "agents" stays the same regardless of theme voice.
const B_CATS = ['#2BB673', '#16A6A6', '#E8A23B', '#E07A5F', '#8E7DBE', '#5BD08A', '#79856E']

// Donut chart. Plain SVG arcs — no chart library. Centre shows the running
// total under a caption; legend reads alongside the chart. The caption is a
// prop so the same donut serves both the capability mix and the doctor-checks
// readiness ring without mislabelling one as the other.
function Donut({ segments, size = 186, stroke = 26, caption = 'capabilities' }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  const r = size / 2 - stroke / 2
  const cx = size / 2
  const cy = size / 2
  let acc = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
      {segments.map((seg, i) => {
        const frac = seg.value / total
        if (frac <= 0) return null
        const start = (acc / total) * 2 * Math.PI - Math.PI / 2
        const end = ((acc + seg.value) / total) * 2 * Math.PI - Math.PI / 2
        acc += seg.value
        const x1 = cx + r * Math.cos(start)
        const y1 = cy + r * Math.sin(start)
        const x2 = cx + r * Math.cos(end)
        const y2 = cy + r * Math.sin(end)
        const large = end - start > Math.PI ? 1 : 0
        return (
          <path
            key={i}
            d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`}
            fill="none"
            stroke={seg.color}
            strokeWidth={stroke}
            strokeLinecap="butt"
          >
            <title>
              {seg.label}: {seg.value}
            </title>
          </path>
        )
      })}
      <text x={cx} y={cy - 4} textAnchor="middle" className="donut-c-num">
        {total}
      </text>
      <text x={cx} y={cy + 16} textAnchor="middle" className="donut-c-cap">
        {caption}
      </text>
    </svg>
  )
}

// Smooth a list of [x,y] points into an SVG path using Catmull-Rom → cubic
// bezier. Returns the `d` string starting with a move-to. The fill baseline is
// closed by the caller.
function smoothPath(points) {
  if (points.length < 2) return points.length ? `M${points[0][0]},${points[0][1]}` : ''
  let d = `M${points[0][0]},${points[0][1]}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] || p2
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`
  }
  return d
}

// Tiny area trend — buckets the values into a smooth SVG path with a fill
// underneath. Used for the Recent runs sub-chart. We render in a real wide
// coordinate space (not a stretched 100-wide box) so the stroke keeps an even
// weight and the curve reads cleanly.
function Trend({ data, height = 156, accent }) {
  if (!data.length) return null
  const w = 600
  const h = height
  const padX = 6
  const padTop = 14
  const padBottom = 6
  const max = Math.max(...data.map((d) => d.v), 1) + 1
  const innerW = w - padX * 2
  const step = data.length > 1 ? innerW / (data.length - 1) : innerW
  const points = data.map((d, i) => {
    const x = padX + i * step
    const y = h - padBottom - (d.v / max) * (h - padTop - padBottom)
    return [x, y]
  })
  const linePath = smoothPath(points)
  const last = points[points.length - 1]
  const first = points[0]
  const areaPath = `${linePath} L${last[0]},${h} L${first[0]},${h} Z`
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height, display: 'block', overflow: 'visible' }}
    >
      <defs>
        <linearGradient id="b-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={accent} stopOpacity=".28" />
          <stop offset="1" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#b-grad)" />
      <path
        d={linePath}
        fill="none"
        stroke={accent}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill={accent} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function BTile({ label, value, sub, color, icon }) {
  return (
    <div className="b-tile">
      <span
        className="b-tile-ic"
        style={{
          background: `color-mix(in srgb, ${color} 18%, transparent)`,
          color,
        }}
      >
        <Icon name={icon} />
      </span>
      <div className="b-tile-body">
        <div className={'b-tile-val' + (value === 0 ? ' zero' : '')}>{value}</div>
        <div className="b-tile-label">{label}</div>
      </div>
      <div className="b-tile-sub">{sub}</div>
    </div>
  )
}

// Voice-flavoured headline copy. Same lookup as Cultivar's StatusView so the
// hero feels coherent across flavours — only the wrapping changes.
const HEADLINES = {
  neutral: 'Loaded & ready',
  imperial: 'The Codex in force',
  military: 'The unit stands ready',
  cyberpunk: 'Jacked in',
  wizard: 'Wards in place',
  pirate: 'The crew stands ready',
  gamer: 'Game loaded',
  sports: 'The squad takes the field',
  biker: 'The crew rolls out',
  commentator: 'Lights out, away we go',
  verstappen: "Setup's in",
  joker: 'Mic check',
  mean: 'Rules are up',
  marvin: 'Online. Reluctantly.',
}

// Greenhouse Status lens — warm, organic, friendly. Hero ring + 4 tiles,
// capability donut + recent-runs trend, activity timeline. Uses real data:
// overview counts, doctor groups (for ring + checks), job log (for the trend
// and timeline). No fabricated series.
export default function GreenhouseView({ overview, sigil, jobs, doctor, onAction }) {
  const c = overview.counts || {}
  const checks = doctor?.groups || []
  const loaded = checks.length > 0
  const pass = checks.filter((g) => g.problems.length === 0).length
  const total = checks.length || 1
  const headline = overview.deployed
    ? HEADLINES[overview.theme] || 'Loaded & ready'
    : 'Not deployed'
  const edits = editCount(overview.diff)

  const mix = SECTION_ORDER.filter((k) => (c[k] || 0) > 0).map((k, i) => ({
    label: SECTIONS[k].label,
    value: c[k] || 0,
    color: B_CATS[i % B_CATS.length],
  }))
  const mixTotal = mix.reduce((s, m) => s + m.value, 0)
  const series = bucketJobsByDay(jobs || [], 10)
  const runsTotal = series.reduce((s, d) => s + d.v, 0)

  return (
    <>
      <div className="b-greet">
        <div>
          <div className="eyebrow">your harness</div>
          <h1 className="h b-h">{headline}</h1>
          <p className="sub">
            {sigil || 'A friendly read of every layer growing in your harness.'}
          </p>
        </div>
        <div className="row gap-8">
          <button className="btn" onClick={() => onAction('update')}>
            <Icon name="refresh" />
            Update
          </button>
          <button className="btn ghost" onClick={() => onAction('build-all')}>
            <Icon name="build" />
            Rebuild
          </button>
        </div>
      </div>

      <div className="grid b-hero-grid mb-16">
        <div className="card b-hero">
          <div className="b-hero-ring">
            <Donut
              segments={[
                { label: 'pass', value: pass, color: B_CATS[0] },
                { label: 'attention', value: Math.max(total - pass, 0), color: B_CATS[2] },
              ]}
              size={168}
              stroke={20}
              caption="checks"
            />
          </div>
          <div className="b-hero-side">
            <h3 className="b-hero-title">
              {loaded ? `${pass} of ${total} checks pass` : 'Running checks…'}
            </h3>
            <p className="sub">
              One source, rendered into <code>{overview.target}</code> and inherited by every repo
              on this machine.
            </p>
            {loaded && (
              <ul className="b-hero-checks">
                {checks.map((ch) => {
                  const ok = ch.problems.length === 0
                  return (
                    <li
                      key={ch.label}
                      className={`b-hcheck ${ok ? 'ok' : 'bad'}`}
                      title={ok ? 'clean' : ch.problems.join('; ')}
                    >
                      <span className="b-hcheck-mark">{ok ? '✓' : '!'}</span>
                      <span className="b-hcheck-label">{ch.label}</span>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="b-chips">
              <span className="b-chip">
                <b style={{ textTransform: 'capitalize' }}>{overview.theme}</b> voice
              </span>
              <span className="b-chip">
                <b>{overview.emit}</b>
              </span>
              <span className="b-chip">
                built <b>{overview.build_time || 'unknown'}</b>
              </span>
            </div>
          </div>
        </div>
        <div className="b-tiles">
          <BTile
            label="Agents"
            value={c.agents ?? '—'}
            sub="specialists"
            color={B_CATS[0]}
            icon="layers"
          />
          <BTile
            label="Skills"
            value={c.skills ?? '—'}
            sub="workflows"
            color={B_CATS[1]}
            icon="skill"
          />
          <BTile label="Laws" value={c.laws ?? '—'} sub="all upheld" color={B_CATS[2]} icon="law" />
          <BTile label="Edits" value={edits} sub="to graft" color={B_CATS[3]} icon="changes" />
        </div>
      </div>

      <div className="grid split-even mb-16">
        <div className="card pad-lg b-mix-card">
          <div className="card-head">
            <h3>Capability mix</h3>
            <div className="right">
              <span className="tick">{mixTotal} total</span>
            </div>
          </div>
          <div className="b-mix">
            <Donut segments={mix} size={186} stroke={26} />
            <div className="b-legend">
              {mix.map((m) => (
                <div className="b-leg-row" key={m.label}>
                  <span className="b-leg-dot" style={{ background: m.color }} />
                  <span className="b-leg-name">{m.label}</span>
                  <span className="b-leg-bar">
                    <i style={{ width: `${(m.value / mixTotal) * 100}%`, background: m.color }} />
                  </span>
                  <span className="b-leg-val">{m.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="card pad-lg">
          <div className="card-head">
            <h3>Recent runs</h3>
            <div className="right">
              <span className="badge ok">
                <span className="dot" />
                job log
              </span>
            </div>
          </div>
          <div className="b-stat-lead">
            <span className="b-stat-big">{runsTotal}</span>
            <span className="b-stat-cap">
              runs in the last 10 days · {pass}/{total} checks pass now
            </span>
          </div>
          <Trend data={series} accent={B_CATS[0]} height={156} />
        </div>
      </div>

      <div className="card pad-lg">
        <div className="card-head">
          <h3>Recent activity</h3>
          <div className="right">
            <span className="tick">last {Math.min(jobs?.length || 0, 12)} runs</span>
          </div>
        </div>
        <div className="b-timeline">
          {(jobs || []).slice(0, MAX_TIMELINE_JOBS).map((j) => {
            const ok = j.status === 'done'
            const bad = j.status === 'failed'
            const cls = bad ? 'warn' : ok ? 'ok' : 'acc'
            return (
              <div className="b-tl-row" key={j.id}>
                <span className={`b-tl-node ${cls}`} />
                <div className="b-tl-body">
                  <b>{j.action}</b>
                  {j.output ? `: ${j.output.split('\n')[0].slice(0, MAX_OUTPUT_PREVIEW)}` : ''}
                </div>
                <span className="b-tl-when">{j.duration ? `${j.duration}s` : j.status}</span>
              </div>
            )
          })}
          {(!jobs || jobs.length === 0) && (
            <div className="b-tl-row">
              <span className="b-tl-node" />
              <div className="b-tl-body sub">No runs yet. Trigger an action to populate this.</div>
              <span className="b-tl-when">—</span>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
