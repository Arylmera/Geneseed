import React from 'react'
import { Icon } from '../../components/Icon.jsx'
import { editCount } from '../../lib/format.js'
import { SECTION_ORDER, SECTIONS } from '../../lib/sections.js'

// Greenhouse "category" palette — warm rich tones that survive on both the
// deep-forest dark and cream-paper light variants. Stable index per section
// so a colour assigned to "agents" stays the same regardless of theme voice.
const B_CATS = ['#2BB673', '#16A6A6', '#E8A23B', '#E07A5F', '#8E7DBE', '#5BD08A', '#79856E']

// Donut chart of capability mix. Plain SVG arcs — no chart library. Centre
// shows the running total; legend reads alongside the chart.
function Donut({ segments, size = 186, stroke = 26 }) {
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
        capabilities
      </text>
    </svg>
  )
}

// Tiny area trend — buckets the values into an SVG path with a fill underneath
// and dots on each point. Used for the Recent runs sub-chart.
function Trend({ data, height = 156, accent }) {
  if (!data.length) return null
  const w = 100
  const h = height
  const max = Math.max(...data.map((d) => d.v), 1) + 1
  const step = data.length > 1 ? w / (data.length - 1) : w
  const points = data.map((d, i) => [i * step, h - (d.v / max) * (h - 12) - 6])
  const linePath = points
    .map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`))
    .join(' ')
  const areaPath = `${linePath} L${w},${h} L0,${h} Z`
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height }}
    >
      <defs>
        <linearGradient id="b-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={accent} stopOpacity=".35" />
          <stop offset="1" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#b-grad)" />
      <path d={linePath} fill="none" stroke={accent} strokeWidth="1.4" />
      {points.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.6" fill={accent} />
      ))}
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
        <div className="b-tile-val">{value}</div>
        <div className="b-tile-label">{label}</div>
      </div>
      <div className="b-tile-sub">{sub}</div>
    </div>
  )
}

// Bucket the job log into a per-day [{t, v}] series for the last `days` days.
// The job log is what /api/jobs returns; we accept it raw.
function runsByDay(jobs, days = 10) {
  const buckets = new Array(days).fill(0).map((_, i) => ({
    t: i === days - 1 ? 'today' : `${days - 1 - i}d`,
    v: 0,
  }))
  const now = Date.now()
  const dayMs = 86400000
  for (const j of jobs) {
    const ts = j.started || j.finished || j.created || j.ts
    if (!ts) continue
    const ms = typeof ts === 'string' ? Date.parse(ts) : ts * 1000
    if (!Number.isFinite(ms)) continue
    const ageDays = Math.floor((now - ms) / dayMs)
    if (ageDays < 0 || ageDays >= days) continue
    buckets[days - 1 - ageDays].v += 1
  }
  return buckets
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
  const series = runsByDay(jobs || [], 10)
  const runsTotal = series.reduce((s, d) => s + d.v, 0)

  return (
    <>
      <div className="b-greet">
        <div>
          <div className="eyebrow">your harness</div>
          <h1 className="h b-h">{headline}</h1>
          <p className="sub">{sigil || 'A friendly read of every layer growing in your harness.'}</p>
        </div>
        <div className="row gap-8">
          <button className="btn" onClick={() => onAction('update')}>
            <Icon name="refresh" />
            Update
          </button>
          <button
            className="btn ghost"
            onClick={() => onAction('build', { theme: overview.theme, emit: overview.emit })}
          >
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
            />
          </div>
          <div className="b-hero-side">
            <h3 className="b-hero-title">{pass} of {total} clean</h3>
            <p className="sub">
              One source, rendered into <code>{overview.target}</code> and inherited by every repo
              on this machine.
            </p>
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
          <BTile label="Agents" value={c.agents ?? '—'} sub="specialists" color={B_CATS[0]} icon="layers" />
          <BTile label="Skills" value={c.skills ?? '—'} sub="workflows" color={B_CATS[1]} icon="skill" />
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
          <div className="b-checks">
            {checks.slice(0, 6).map((ch) => {
              const ok = ch.problems.length === 0
              return (
                <span key={ch.label} className={`b-check ${ok ? 'ok' : 'bad'}`}>
                  {ok ? '✓' : '!'} {ch.label}
                </span>
              )
            })}
          </div>
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
          {(jobs || []).slice(0, 12).map((j) => {
            const ok = j.status === 'done'
            const bad = j.status === 'failed'
            const cls = bad ? 'warn' : ok ? 'ok' : 'acc'
            return (
              <div className="b-tl-row" key={j.id}>
                <span className={`b-tl-node ${cls}`} />
                <div className="b-tl-body">
                  <b>{j.action}</b>
                  {j.output ? ` — ${j.output.split('\n')[0].slice(0, 120)}` : ''}
                </div>
                <span className="b-tl-when">
                  {j.duration ? `${j.duration}s` : j.status}
                </span>
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
