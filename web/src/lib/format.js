// Small, pure presentation helpers shared across pages. Kept dependency-free and
// side-effect-free so they are trivially testable and reusable — the JS analogue
// of the little helpers in _harness_core (run, _within, strip_code).
import { SECTION_ORDER } from './sections.js'

const SECS_PER_MIN = 60
const SECS_PER_HOUR = 3600
const SECS_PER_DAY = 86400
// Bucket boundaries (in seconds): under 90s → seconds, under 90m → minutes,
// under 36h → hours, else days. Larger boundary = older.
const REL_TIME_BOUNDS = {
  seconds: 90,
  minutes: 90 * SECS_PER_MIN,
  hours: 36 * SECS_PER_HOUR,
}

// A coarse "time ago" label (e.g. 42s, 7m, 3h, 2d) from an epoch-seconds stamp.
export function relTime(epochSecs) {
  const s = Math.max(0, Date.now() / 1000 - epochSecs)
  if (s < REL_TIME_BOUNDS.seconds) return `${Math.round(s)}s`
  if (s < REL_TIME_BOUNDS.minutes) return `${Math.round(s / SECS_PER_MIN)}m`
  if (s < REL_TIME_BOUNDS.hours) return `${Math.round(s / SECS_PER_HOUR)}h`
  return `${Math.round(s / SECS_PER_DAY)}d`
}

// Shorten a deploy target for the fake prompt: collapse the home dir to "~"
// (POSIX and Windows), normalise separators.
export function promptPath(target) {
  if (!target) return '~'
  return target
    .replace(/\\/g, '/')
    .replace(/^\/?(home|Users)\/[^/]+/i, '~')
    .replace(/^[A-Z]:\/Users\/[^/]+/i, '~')
}

// Weighted signals that sum to the 0..1 readiness score below.
const READINESS = {
  deployed: 0.4,
  doctorClean: 0.25,
  doctorMinor: 0.15, // a few problems still counts as mostly-healthy
  doctorMinorMax: 2, // ...up to this many
  doctorFail: 0.05,
  versionSynced: 0.2,
  diskClean: 0.15,
}

// Health of the deployment as one 0..1 number: deployed 40%, doctor up to 25%,
// version in sync 20%, nothing missing on disk 15%.
export function readiness(ov, setup) {
  if (!ov) return 0
  const problems = ov.doctor?.problems?.length ?? 99
  const doctorScore = ov.doctor?.ok
    ? READINESS.doctorClean
    : problems <= READINESS.doctorMinorMax
      ? READINESS.doctorMinor
      : READINESS.doctorFail
  const versionSynced = setup && setup.installed_fp && setup.installed_fp === setup.source_fp
  return (
    (ov.deployed ? READINESS.deployed : 0) +
    doctorScore +
    (versionSynced ? READINESS.versionSynced : 0) +
    (ov.diff && ov.diff.missing === 0 ? READINESS.diskClean : 0)
  )
}

// Largest section count (floored at 1) — the denominator for proportional bars.
export const maxCount = (counts) => Math.max(...SECTION_ORDER.map((k) => counts?.[k] ?? 0), 1)

// Local edits awaiting export = edited + added files from the diff summary.
export const editCount = (diff) => (diff?.edited ?? 0) + (diff?.added ?? 0)
