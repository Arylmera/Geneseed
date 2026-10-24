const MS_PER_DAY = 86400000

// Bucket the raw job log (what /api/jobs returns) into a per-day [{ t, v }] series for
// the last `days` days, oldest first and newest last. `todayLabel` names the final
// bucket — 'today' on the roomy Greenhouse view, '0d' on the dense Operator readout.
// Timestamps may be ISO strings or unix seconds; jobs with no/unparseable timestamp or
// outside the window are skipped. Shared by GreenhouseView and OperatorHudView.
export function bucketJobsByDay(jobs, days = 10, todayLabel = 'today') {
  const buckets = new Array(days).fill(0).map((_, i) => ({
    t: i === days - 1 ? todayLabel : `${days - 1 - i}d`,
    v: 0,
  }))
  const now = Date.now()
  for (const j of jobs) {
    const ts = j.started || j.finished || j.created || j.ts
    if (!ts) continue
    const ms = typeof ts === 'string' ? Date.parse(ts) : ts * 1000
    if (!Number.isFinite(ms)) continue
    const ageDays = Math.floor((now - ms) / MS_PER_DAY)
    if (ageDays < 0 || ageDays >= days) continue
    buckets[days - 1 - ageDays].v += 1
  }
  return buckets
}

// The `n` most recently started jobs, newest first. The server sends the log oldest
// first and useJobs appends, so a plain `.slice(0, n)` showed the OLDEST runs as "recent".
export const newestJobs = (jobs, n) =>
  [...(jobs || [])].sort((a, b) => (b.started || 0) - (a.started || 0)).slice(0, n)

// The flags that say what a run touched, in the order they read best. Not `--out`: its
// value is an absolute path, and a path with a space is cut (see the split below).
const SCOPE_FLAGS = ['--emit', '--theme', '--scope']
const RESULT = { done: '✓', failed: '✗' }

// One short line per run for the previews: `verb · scope · result · duration`. The raw
// `$ <argv>` line carries an absolute interpreter path on Windows (`$ C:\…\node.exe …`),
// which is noise as visible text, so it comes back apart as `command`, for a tooltip.
// Scope is best effort: the flag values when the `$` line has them, else empty.
export function jobSummary(job) {
  const command = (job.output || '').split('\n').find((l) => l.startsWith('$ ')) || ''
  // shortcut: the `$` line is argv joined unquoted (js/web/jobs.mjs), so it cannot be split
  // back into argv exactly; whitespace splitting is right only for space-free values.
  const argv = command.split(/\s+/)
  const scope = []
  argv.forEach((a, i) => {
    const [flag, inline] = a.split('=')
    const value = inline || argv[i + 1]
    // A flag with no value must not take the next flag for one.
    if (SCOPE_FLAGS.includes(flag) && value && !value.startsWith('--')) scope.push(value)
  })
  return {
    // Local runs label themselves `build (theme · emit)`; the verb is the first word.
    verb: (job.action || 'run').split(/[\s(]/)[0],
    scope: scope.join(' · '),
    result: RESULT[job.status] || '…',
    duration: job.duration ? `${job.duration}s` : '—',
    command,
  }
}
