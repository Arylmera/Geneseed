import React from 'react'
import { relTime } from '../../lib/format.js'
import { jobSummary, newestJobs } from '../../lib/jobBuckets.js'

const TONE = { done: 'ok', failed: 'bad' }
const ICON = {
  done: <path d="M5 12l5 5L20 7" />,
  failed: <path d="M6 6l12 12M18 6L6 18" />,
}
const isNum = (d) => typeof d === 'number' && Number.isFinite(d)

// Fold ADJACENT runs that read the same — verb, scope and outcome — into one group, so ten
// identical rebuilds take one line instead of ten. The status is part of the key: a failure
// folded into a ✓ group would disappear. `jobs` is already newest first and capped, so the
// first job of a group is its newest.
export function groupRuns(jobs) {
  const groups = []
  for (const j of jobs) {
    const s = jobSummary(j)
    const key = `${s.verb}\u0000${s.scope}\u0000${j.status}`
    const last = groups[groups.length - 1]
    if (last && last.key === key) {
      last.jobs.push(j)
      last.durations.push(isNum(j.duration) ? j.duration : null)
      if (j.started) last.oldest = j.started
      continue
    }
    groups.push({
      key,
      id: j.id,
      verb: s.verb,
      scope: s.scope,
      status: j.status,
      jobs: [j],
      command: s.command,
      newest: j.started || null,
      oldest: j.started || null,
      durations: [isNum(j.duration) ? j.duration : null],
    })
  }
  return groups
}

// When a group ran: one age, or a span when its ends read differently ("5m – 1m ago").
function when(g) {
  if (!g.newest) return '—'
  const newest = relTime(g.newest)
  const oldest = g.oldest ? relTime(g.oldest) : newest
  return oldest === newest ? `${newest} ago` : `${oldest} – ${newest} ago`
}

// The run log of the Dashboard lenses as chips: one per run, or per group of adjacent identical
// runs. Each chip shows only what the job record holds — outcome, verb, scope, age, duration —
// never an invented count or date. The raw `$ argv` line is the tooltip, not the text: on
// Windows it opens with an absolute interpreter path (lib/jobBuckets.js). There is no click
// target: opening a job's console needs App.jsx plumbing these views do not get, and
// #/activity lists agent sessions, not jobs, so a link there would mislead.
export default function RunChips({ jobs, max, empty }) {
  if (!jobs || jobs.length === 0) return empty ?? null
  const shown = newestJobs(jobs, max)
  // Bars are sized against the slowest run on screen, so a 3 s run reads short beside a 30 s one.
  const slowest = Math.max(0, ...shown.map((j) => (isNum(j.duration) ? j.duration : 0))) || 1
  const groups = groupRuns(shown)
  // The bar column is split by the largest group, so equal durations draw equal bars in every
  // chip instead of flex squeezing a ×3 group's bars to a third of a single run's.
  const share = Math.max(...groups.map((g) => g.jobs.length))
  return (
    <ul className="run-chips">
      {groups.map((g) => {
        const done = g.durations.filter(isNum)
        const n = g.jobs.length
        const label = g.status || 'running'
        return (
          <li
            key={g.id}
            className={`run-chip ${TONE[g.status] || 'acc'}`}
            title={g.command || undefined}
          >
            <svg
              className="run-chip-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {ICON[g.status] || <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />}
            </svg>
            <span className="sr-only">{label}</span>
            <span className="run-chip-main">
              <span className="run-chip-head">
                <b>{g.verb}</b>
                {n > 1 && <span className="run-chip-times">×{n}</span>}
              </span>
              <span className="run-chip-sub">{[g.scope, when(g)].filter(Boolean).join(' · ')}</span>
            </span>
            {done.length ? (
              <span
                className="run-chip-bars"
                role="img"
                aria-label={`Durations: ${done.join(', ')} seconds`}
              >
                {done.map((d, i) => (
                  <i key={i} style={{ width: `${(d / slowest / share) * 100}%` }} />
                ))}
              </span>
            ) : (
              <span className="run-chip-bars" aria-hidden="true" />
            )}
            <span className="run-chip-dur">
              {!done.length ? '—' : n > 1 ? `≤ ${Math.max(...done)} s` : `${done[0]} s`}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
