import React from 'react'
import { go } from '../../lib/router.js'
import { SECTIONS, SECTION_ORDER } from '../../lib/sections.js'
import { maxCount, editCount } from '../../lib/format.js'
import ActivityFeed from './ActivityFeed.jsx'

// Direction C · Operator — a dense, terminal-flavoured status strip and a
// sortable-feeling sections table for operators who want numbers, not chrome.
export default function OperatorView({ overview, setup, jobs }) {
  const total = SECTION_ORDER.reduce((s, k) => s + (overview.counts?.[k] ?? 0), 0)
  const max = maxCount(overview.counts)
  const doctorOk = overview.doctor?.ok
  const issueCount = overview.doctor?.problems?.length ?? 0
  const edits = editCount(overview.diff)

  return (
    <>
      <div className="card pad-md rise mb-16">
        <div className="row wrap between gap-16">
          <div className="row" style={{ gap: 20, flexWrap: 'wrap' }}>
            <div>
              <div className="tick">status</div>
              <div className="row" style={{ gap: 8, marginTop: 4 }}>
                <span className={`badge ${overview.deployed ? 'ok' : 'warn'}`}>
                  <span className="dot" />
                  {overview.deployed ? 'deployed' : 'not deployed'}
                </span>
              </div>
            </div>
            <div>
              <div className="tick">voice</div>
              <div
                className="metric"
                style={{ fontSize: 18, marginTop: 6, textTransform: 'capitalize' }}
              >
                {overview.theme}
              </div>
            </div>
            <div>
              <div className="tick">mode</div>
              <div className="mono" style={{ fontSize: 14, marginTop: 6 }}>
                {overview.emit}
              </div>
            </div>
            <div>
              <div className="tick">fingerprint</div>
              <div className="mono" style={{ fontSize: 14, marginTop: 6, color: 'var(--accent)' }}>
                {setup?.installed_fp || '—'}
              </div>
            </div>
            <div>
              <div className="tick">doctor</div>
              <div className="row" style={{ gap: 8, marginTop: 4 }}>
                {doctorOk ? (
                  <span className="badge ok">
                    <span className="dot" />
                    clean
                  </span>
                ) : (
                  <span className="badge warn">
                    <span className="dot" />
                    {issueCount} issue{issueCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
            <div>
              <div className="tick">edits</div>
              <div className="metric" style={{ fontSize: 18, marginTop: 6 }}>
                {edits}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid split-operator">
        <div className="card rise" style={{ animationDelay: '60ms' }}>
          <div className="card-head pad-lg" style={{ padding: '18px 20px 0', marginBottom: 14 }}>
            <h3>Sections</h3>
            <div className="right">
              <span className="tick">{total} entries total</span>
            </div>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Section</th>
                <th>Detail</th>
                <th style={{ width: 130 }}>Share</th>
                <th className="num">Count</th>
              </tr>
            </thead>
            <tbody>
              {SECTION_ORDER.map((k) => {
                const m = SECTIONS[k],
                  v = overview.counts?.[k] ?? 0
                return (
                  <tr key={k} className="clickable" onClick={() => go('#/section/' + k)}>
                    <td className="name">{m.label}</td>
                    <td className="muted">{m.desc}</td>
                    <td>
                      <div className="hbar">
                        <i style={{ width: `${(v / max) * 100}%` }} />
                      </div>
                    </td>
                    <td className="num">{v}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="card pad-lg rise" style={{ animationDelay: '120ms' }}>
          <div className="card-head">
            <h3>Run log</h3>
          </div>
          <ActivityFeed jobs={jobs} />
        </div>
      </div>
    </>
  )
}
