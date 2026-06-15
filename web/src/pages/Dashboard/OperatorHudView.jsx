import React from 'react'
import { Icon } from '../../components/Icon.jsx'
import { editCount } from '../../lib/format.js'
import { SECTION_ORDER, SECTIONS } from '../../lib/sections.js'

// One module panel — header tab + title + body. Operator HUD's basic container.
function CMod({ title, right, children, span }) {
  return (
    <div className="c-mod" style={span ? { gridColumn: `span ${span}` } : null}>
      <div className="c-mod-head">
        <span className="c-tab" />
        <h3>{title}</h3>
        {right && <span className="c-mod-right">{right}</span>}
      </div>
      <div className="c-mod-body">{children}</div>
    </div>
  )
}

function CKpi({ label, value }) {
  return (
    <div className="c-kpi">
      <div className="c-kpi-label">{label}</div>
      <div className="c-kpi-val">{value}</div>
    </div>
  )
}

// Micro-column chart — one thin bar per day; the most recent column highlights.
function MicroColumns({ data, height = 120, hi }) {
  if (!data.length) return null
  const max = Math.max(...data.map((d) => d.v), 1)
  return (
    <div className="c-cols" style={{ height }}>
      {data.map((d, i) => {
        const h = Math.max((d.v / max) * (height - 6), 2)
        return (
          <div
            key={i}
            className={`c-col ${i === hi ? 'hi' : ''}`}
            style={{ height: h }}
            title={`${d.t}: ${d.v}`}
          />
        )
      })}
    </div>
  )
}

// Tally band — N green dots for passing checks, then red for failing. Read at a
// glance whether the engine is mostly green.
function CheckBand({ checks }) {
  return (
    <div className="c-band">
      {checks.map((g, i) => (
        <span
          key={i}
          className={`c-band-cell ${g.problems.length === 0 ? 'ok' : 'bad'}`}
          title={`${g.label}: ${g.problems.length === 0 ? 'pass' : `${g.problems.length} problem(s)`}`}
        />
      ))}
    </div>
  )
}

// Bucket the job log into per-day [{t, v}]. Same helper Greenhouse uses but
// with shorter day labels suited to the dense Operator readout.
function runsByDay(jobs, days = 10) {
  const buckets = new Array(days).fill(0).map((_, i) => ({
    t: i === days - 1 ? '0d' : `${days - 1 - i}d`,
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

// Roll up the job log into a per-action-type tally for the RUN LOG // BY TYPE
// table. Sorted by count descending so the most common runs sit on top.
function runMix(jobs) {
  const m = {}
  for (const j of jobs || []) {
    const k = j.action || 'unknown'
    m[k] = (m[k] || 0) + 1
  }
  return Object.entries(m)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
}

// Operator HUD Status lens — flat instrument panels, mono everywhere, real
// data only (overview counts, doctor groups, job log). Modelled on the
// design's flavourC dashboard but reshaped to the React app's data shapes.
export default function OperatorHudView({ overview, jobs, doctor, onAction }) {
  const c = overview.counts || {}
  const total = SECTION_ORDER.reduce((s, k) => s + (c[k] || 0), 0)
  const max = Math.max(...SECTION_ORDER.map((k) => c[k] || 0), 1)
  const checks = doctor?.groups || []
  const pass = checks.filter((g) => g.problems.length === 0).length
  const series = runsByDay(jobs || [], 10)
  const runsTotal = series.reduce((s, d) => s + d.v, 0)
  const mix = runMix(jobs)
  const mixMax = Math.max(...mix.map((m) => m.value), 1)
  const edits = editCount(overview.diff)

  // Each cell is rendered with its own key on the wrapping <div> below; the
  // inline JSX values here don't need keys but ESLint's react/jsx-key rule
  // fires on JSX literals in array-positional code, so we suppress it.
  /* eslint-disable react/jsx-key */
  const strip = [
    [
      'status',
      overview.deployed ? (
        <span className="c-pill ok">DEPLOYED</span>
      ) : (
        <span className="c-pill warn">NOT DEPLOYED</span>
      ),
    ],
    ['voice', <span style={{ textTransform: 'capitalize' }}>{overview.theme}</span>],
    ['mode', overview.emit],
    [
      'doctor',
      checks.length === 0 ? (
        <span className="c-pill">—</span>
      ) : pass === checks.length ? (
        <span className="c-pill ok">CLEAN</span>
      ) : (
        <span className="c-pill warn">{checks.length - pass} ISSUES</span>
      ),
    ],
    ['edits', String(edits)],
    ['built', overview.build_time || '—'],
    ['target', <span className="c-dim mono">{overview.target}</span>],
  ]
  /* eslint-enable react/jsx-key */

  return (
    <div className="c-root">
      <div className="c-titlebar">
        <div>
          <h1 className="c-h1">HARNESS // STATUS READOUT</h1>
          <div className="c-sub">{overview.target} · rendered from src/ · inherited everywhere</div>
        </div>
        <div className="row gap-8">
          <button className="btn" onClick={() => onAction('update')}>
            <Icon name="refresh" />
            UPDATE
          </button>
          <button
            className="btn ghost"
            onClick={() => onAction('build', { theme: overview.theme, emit: overview.emit })}
          >
            REBUILD
          </button>
          <button className="btn ghost" onClick={() => onAction('doctor')}>
            DOCTOR
          </button>
        </div>
      </div>

      <div className="c-strip">
        {strip.map(([k, v], i) => (
          <div className="c-strip-cell" key={i}>
            <div className="c-strip-k">{k}</div>
            <div className="c-strip-v">{v}</div>
          </div>
        ))}
      </div>

      <div className="c-kpi-row">
        <CKpi label="AGENTS" value={c.agents ?? '—'} />
        <CKpi label="SKILLS" value={c.skills ?? '—'} />
        <CKpi label="LAWS" value={c.laws ?? '—'} />
        <CKpi label="MEMORY" value={c.memory ?? '—'} />
        <CKpi label="NOTEBOOK" value={c.notebook ?? '—'} />
        <CKpi label="EDITS" value={edits} />
      </div>

      <div className="c-grid">
        <CMod title="CAPABILITY DISTRIBUTION" right={`${total} ENTRIES`} span={2}>
          <table className="c-tbl">
            <thead>
              <tr>
                <th>SECTION</th>
                <th>DETAIL</th>
                <th style={{ width: 150 }}>SHARE</th>
                <th className="num">N</th>
              </tr>
            </thead>
            <tbody>
              {SECTION_ORDER.map((k) => (
                <tr key={k}>
                  <td className="c-name">{SECTIONS[k].label}</td>
                  <td className="c-dim">{SECTIONS[k].desc}</td>
                  <td>
                    <div className="c-bar">
                      <i
                        style={{
                          width: `${((c[k] || 0) / max) * 100}%`,
                          background:
                            k === 'agents' || k === 'skills' ? 'var(--accent)' : 'var(--line-3)',
                        }}
                      />
                    </div>
                  </td>
                  <td className="num">{c[k] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CMod>

        <CMod title="DOCTOR // CHECKS" right={checks.length ? `${pass}/${checks.length}` : '—'}>
          {checks.length > 0 ? (
            <>
              <CheckBand checks={checks} />
              <div className="c-check-list">
                {checks.map((g) => {
                  const ok = g.problems.length === 0
                  return (
                    <div className="c-check-row" key={g.label}>
                      <span className={`c-dotmark ${ok ? 'ok' : 'bad'}`} />
                      <span className="c-check-name">{g.label}</span>
                      <span className="c-check-detail">
                        {ok
                          ? 'clean'
                          : `${g.problems.length} problem${g.problems.length === 1 ? '' : 's'}`}
                      </span>
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <p className="c-dim mono" style={{ fontSize: 11 }}>
              No doctor run loaded yet.
            </p>
          )}
        </CMod>

        <CMod title="RUN RATE // 10D" right={`${runsTotal} RUNS`} span={2}>
          <MicroColumns data={series} height={120} hi={series.length - 1} />
          <div className="c-axis">
            {series.map((d, i) => (
              <span key={i}>{i % 2 === 0 ? d.t : ''}</span>
            ))}
          </div>
        </CMod>

        <CMod title="RUN LOG // BY TYPE" right={`${(jobs || []).length} LOGGED`}>
          {mix.length > 0 ? (
            <table className="c-tbl">
              <tbody>
                {mix.map((m) => (
                  <tr key={m.label}>
                    <td className="c-name" style={{ textTransform: 'uppercase', fontWeight: 400 }}>
                      {m.label}
                    </td>
                    <td>
                      <div className="c-bar">
                        <i
                          style={{
                            width: `${(m.value / mixMax) * 100}%`,
                            background: 'var(--accent)',
                          }}
                        />
                      </div>
                    </td>
                    <td className="num">{m.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="c-dim mono" style={{ fontSize: 11 }}>
              No runs logged.
            </p>
          )}
        </CMod>

        <CMod title="RECENT // RUN LOG" span={3}>
          <table className="c-tbl">
            <tbody>
              {(jobs || []).slice(0, 14).map((j) => {
                const ok = j.status === 'done'
                const bad = j.status === 'failed'
                const cls = bad ? 'bad' : ok ? 'ok' : 'acc'
                const preview = j.output ? j.output.split('\n')[0].slice(0, 120) : '—'
                return (
                  <tr key={j.id}>
                    <td style={{ width: 96 }}>
                      <span className={`c-dotmark ${cls}`} />{' '}
                      <span className="c-dim">{j.action}</span>
                    </td>
                    <td className="c-name" style={{ fontWeight: 400 }}>
                      {preview}
                    </td>
                    <td className="num c-dim">{j.duration ? `${j.duration}s` : j.status}</td>
                  </tr>
                )
              })}
              {(!jobs || jobs.length === 0) && (
                <tr>
                  <td colSpan="3" className="c-dim" style={{ fontSize: 11 }}>
                    No runs logged.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CMod>
      </div>
    </div>
  )
}
