import React, { useEffect, useState } from 'react'

// Shared render vocabulary for the Activity list (cards) and the session-detail page.

// Status → badge variant + label + left-accent colour. Only four badge variants exist,
// so blocked reuses `bad` (the "stuck / needs you" red) — distinct from `warn` (your
// move) and the dim idle.
export const STATUS = {
  busy: { cls: 'acc', label: 'working', accent: 'var(--accent)' },
  'waiting-input': { cls: 'warn', label: 'your move', accent: 'var(--warn)' },
  blocked: { cls: 'bad', label: 'blocked', accent: 'var(--bad)' },
  idle: { cls: '', label: 'idle', accent: 'var(--line)' },
}

export const ELLIPSIS = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

// Last path segment of a working dir — the heading when a session has no title yet.
export function baseName(p) {
  if (!p) return ''
  const parts = p.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || p
}

// 48213 → "48.2k", 250000 → "250k", 1.2e6 → "1.2M".
//
// Pinned to 'en-US' rather than the viewer's locale: this is a token count beside a
// monospace, terminal-styled dashboard, not prose, and Intl's compact notation otherwise
// follows the browser's locale — a comma decimal, different grouping — which would read as
// a formatting bug next to the rest of the console. `K` is lowercased to match the existing
// 'k' this file (and its tests) already use; `M` was already this shape.
const COMPACT_FMT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})
export const compact = (n) => (!n ? '0' : COMPACT_FMT.format(n).replace(/K$/, 'k'))

export function fmtElapsed(sec) {
  sec = Math.max(0, Math.floor(sec))
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}m ${sec % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

// Live turn-elapsed: ticks each second from the turn's start (epoch seconds).
export function Elapsed({ startedAt }) {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(t)
  }, [])
  return fmtElapsed(now - startedAt)
}

export function TodoStrip({ done, total }) {
  const n = Math.min(total, 10)
  const filled = Math.min(n, Math.round((done / total) * n))
  return (
    <span style={{ letterSpacing: 2 }}>
      <span style={{ color: 'var(--accent)' }}>{'●'.repeat(filled)}</span>
      <span style={{ color: 'var(--text-3)' }}>{'○'.repeat(n - filled)}</span>
    </span>
  )
}
