import React from 'react'
import { Icon } from '../../components/Icon.jsx'
import Ring from '../../components/Ring.jsx'
import { editCount } from '../../lib/format.js'
import { bucketJobsByDay, newestJobs } from '../../lib/jobBuckets.js'
import { headlineFor } from '../../lib/headlines.js'
import { SECTION_ORDER, SECTIONS } from '../../lib/sections.js'
import { CountUp } from '../../lib/motion.js'
import RunChips from './RunChips.jsx'
import VerdictBadge from './VerdictBadge.jsx'

// Recent-activity panel: how many jobs the run chips draw from.
const MAX_TIMELINE_JOBS = 12

// Greenhouse "category" palette — stable index per section so a colour assigned to "agents"
// stays the same regardless of theme voice. The colours are the --cat-N tokens in styles.css,
// which carry light-mode twins: one dark hex for both modes fell to ~2:1 on cream paper.
const B_CATS = Array.from({ length: 7 }, (_, i) => `var(--cat-${i})`)

// Donut chart: the shared ring, with the running total and its caption over the centre. The
// caption is a prop so the same donut serves both the capability mix and the doctor-checks
// readiness ring without mislabelling one as the other. `segments` are the ring's own
// [{ key, label, n, tone }].
const DONUT_SWEEP_MS = 650
function Donut({ segments, size = 186, stroke = 26, caption = 'capabilities' }) {
  const sum = segments.reduce((s, x) => s + x.n, 0)
  return (
    <div className="ring-box">
      <Ring
        segments={segments}
        size={size}
        stroke={stroke}
        label={caption}
        sweepMs={DONUT_SWEEP_MS}
      />
      <div className="ring-center">
        <div className="donut-c-num">
          <CountUp value={sum} duration={DONUT_SWEEP_MS} />
        </div>
        <div className="donut-c-cap">{caption}</div>
      </div>
    </div>
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
          {/* Colours as style, not attributes: `accent` is a var(), which a presentation
              attribute is not guaranteed to resolve. */}
          <stop offset="0" style={{ stopColor: accent }} stopOpacity=".28" />
          <stop offset="1" style={{ stopColor: accent }} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#b-grad)" />
      <path
        d={linePath}
        fill="none"
        style={{ stroke: accent }}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={last[0]}
        cy={last[1]}
        r="3.5"
        style={{ fill: accent }}
        vectorEffect="non-scaling-stroke"
      />
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

// Greenhouse Status lens — warm, organic, friendly. Hero ring + 4 tiles,
// capability donut + recent-runs trend, activity timeline. Uses real data:
// overview counts, doctor groups (for ring + checks), job log (for the trend
// and timeline). No fabricated series.
export default function GreenhouseView({ overview, sigil, jobs, lens, onAction }) {
  const c = overview.counts || {}
  const doctorState = lens?.doctor?.state || 'loading'
  const checks = lens?.doctor?.data?.groups || []
  const loaded = doctorState === 'ok'
  const pass = checks.filter((g) => g.problems.length === 0).length
  // The real count: with no checks yet the ring is an empty track, not one amber failure.
  const total = checks.length
  const headline = headlineFor(overview, lens?.tone)
  const shown = newestJobs(jobs, MAX_TIMELINE_JOBS)
  const edits = editCount(overview.diff)

  // `tone-cat<i>` is B_CATS[i] for the ring's arc; the legend paints B_CATS itself.
  const mix = SECTION_ORDER.filter((k) => (c[k] || 0) > 0).map((k, i) => ({
    key: k,
    label: SECTIONS[k].label,
    n: c[k] || 0,
    tone: 'cat' + (i % B_CATS.length),
    color: B_CATS[i % B_CATS.length],
  }))
  const mixTotal = mix.reduce((s, m) => s + m.n, 0)
  const series = bucketJobsByDay(jobs || [], 10)
  const runsTotal = series.reduce((s, d) => s + d.v, 0)

  return (
    <>
      <div className="b-greet">
        <div>
          <div className="eyebrow">your harness</div>
          <h2 className="h b-h">{headline}</h2>
          <VerdictBadge verdict={lens?.verdict} />
          <p className="sub">
            {sigil || 'A friendly read of every layer growing in your harness.'}
          </p>
        </div>
      </div>

      <div className="grid b-hero-grid mb-16">
        <div className="card b-hero">
          <div className="b-hero-ring">
            <Donut
              segments={[
                { key: 'pass', label: 'pass', n: pass, tone: 'good' },
                {
                  key: 'attention',
                  label: 'attention',
                  n: Math.max(total - pass, 0),
                  tone: 'warn',
                },
              ]}
              size={168}
              stroke={20}
              caption="checks"
            />
          </div>
          <div className="b-hero-side">
            <h3 className="b-hero-title">
              {loaded
                ? `${pass} of ${total} checks pass`
                : doctorState === 'failed'
                  ? 'Doctor did not answer'
                  : 'Checking…'}
            </h3>
            {doctorState === 'failed' && (
              <button
                className="btn ghost b-hero-retry"
                aria-label="Run doctor again"
                onClick={() => onAction('doctor')}
              >
                <Icon name="doctor" />
                Run doctor
              </button>
            )}
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
                <b className="t-cap">{overview.theme}</b> voice
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
          {/* `c.laws` is the INVARIANT count, so the tile says so — and the sub-line is where
              the packs become visible at a glance, which is the whole point of a build-time
              toggle: an install running three of four packs must LOOK different from one
              running all four. */}
          <BTile
            label="Dictates"
            value={c.laws ?? '—'}
            sub={
              c.doctrines
                ? `${c.doctrines.active}/${c.doctrines.total} packs · ${c.doctrines.rules} rules`
                : 'all upheld'
            }
            color={B_CATS[2]}
            icon="law"
          />
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
                    <i style={{ width: `${(m.n / mixTotal) * 100}%`, background: m.color }} />
                  </span>
                  <span className="b-leg-val">{m.n}</span>
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
            <span className="b-stat-big">
              <CountUp value={runsTotal} />
            </span>
            <span className="b-stat-cap">
              runs in the last 10 days
              {loaded && total > 0 && ` · ${pass}/${total} checks pass now`}
            </span>
          </div>
          <Trend data={series} accent={B_CATS[0]} height={156} />
        </div>
      </div>

      <div className="card pad-lg">
        <div className="card-head">
          <h3>Recent activity</h3>
          <div className="right">
            <span className="tick">last {shown.length} runs</span>
          </div>
        </div>
        <RunChips
          jobs={jobs}
          max={MAX_TIMELINE_JOBS}
          empty={<p className="sub">No runs yet. Trigger an action to populate this.</p>}
        />
      </div>
    </>
  )
}
