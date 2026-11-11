import { useEffect } from 'react'

// The updater every poll writes its answer through: `setData(sameOr(d))`. An answer equal to the
// one on screen (same JSON) keeps the old reference, so React bails out and a quiet tick re-renders
// nothing. Compared inside the updater, not against a closed-over value, so overlapping ticks stay
// race-safe — the guard hooks/useJobs.js keeps per field. Each answer is stringified once: the one
// on screen keeps its string here (an Activity answer can near 1 MB, ~14 ms a stringify). A value
// set without sameOr has no string and counts as changed.
const JSON_OF = new WeakMap()
export const sameOr = (d) => (prev) => {
  const next = JSON.stringify(d)
  if (prev != null && typeof prev === 'object' && JSON_OF.get(prev) === next) return prev
  if (d != null && typeof d === 'object') JSON_OF.set(d, next)
  return d
}

// Run `fn` now, then every `ms` while the tab is visible, and once more the moment a
// hidden tab is fronted again — so a HUD nobody is looking at costs no round-trips, and
// one that comes back into view refreshes at once instead of waiting out the interval.
// `deps` restart the poll (same contract as useEffect's array).
//
// `fn` receives `alive()`: false once this poll has been torn down (unmount, or `deps`
// moved on). A response that lands after that belongs to the previous subject — the
// session the user navigated away from — and must not be written into state.
//
// Activity and ActivityDetail each carried a hand-rolled copy of exactly this; the job
// console's poller (hooks/useJobs.js) is different in kind — it stops itself when the job
// ends — and stays its own. Each caller writes through `sameOr` above.
export function usePoll(fn, ms, deps) {
  useEffect(() => {
    let alive = true
    const isAlive = () => alive
    const tick = () => {
      if (!document.hidden) fn(isAlive)
    }
    fn(isAlive)
    const t = setInterval(tick, ms)
    document.addEventListener('visibilitychange', tick)
    return () => {
      alive = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', tick)
    }
    // `deps` is the caller's restart trigger; `fn` is re-read whenever it fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
