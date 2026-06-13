// Small, pure presentation helpers shared across pages. Kept dependency-free and
// side-effect-free so they are trivially testable and reusable — the JS analogue
// of the little helpers in _harness_core (run, _within, strip_code).
import { SECTION_ORDER } from './sections.js'

// A coarse "time ago" label (e.g. 42s, 7m, 3h, 2d) from an epoch-seconds stamp.
export function relTime(epochSecs) {
  const s = Math.max(0, Date.now() / 1000 - epochSecs)
  if (s < 90) return `${Math.round(s)}s`
  if (s < 5400) return `${Math.round(s / 60)}m`
  if (s < 129600) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
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

// Health of the deployment as one 0..1 number: deployed 40%, doctor up to 25%,
// version in sync 20%, nothing missing on disk 15%.
export function readiness(ov, setup) {
  if (!ov) return 0
  const doctorScore = ov.doctor?.ok ? 0.25
    : (ov.doctor?.problems?.length ?? 99) <= 2 ? 0.15 : 0.05
  return (ov.deployed ? 0.40 : 0)
    + doctorScore
    + (setup && setup.installed_fp && setup.installed_fp === setup.source_fp ? 0.20 : 0)
    + (ov.diff && ov.diff.missing === 0 ? 0.15 : 0)
}

// Largest section count (floored at 1) — the denominator for proportional bars.
export const maxCount = (counts) =>
  Math.max(...SECTION_ORDER.map((k) => counts?.[k] ?? 0), 1)

// Local edits awaiting export = edited + added files from the diff summary.
export const editCount = (diff) => (diff?.edited ?? 0) + (diff?.added ?? 0)
