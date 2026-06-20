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
