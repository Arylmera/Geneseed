import React from 'react'
import { go } from '../../lib/router.js'

// The Understand group read as a course: numbered steps with progress in the sidebar and a
// prev/next bar under the article. Progress is the reader's own, in localStorage only —
// the ids of the understand pages they have opened. The Overview's "New here?" card reads
// the same key.
export const SEEN_KEY = 'geneseed-understand-seen'
export const TRACK_GROUP = 'understand'

export function readSeen() {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY))
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function markSeen(id) {
  const seen = readSeen()
  if (seen.includes(id)) return seen
  const next = [...seen, id]
  localStorage.setItem(SEEN_KEY, JSON.stringify(next))
  return next
}

// The page before and after `pageId` on the track. Past the last step, "next" leaves the
// course for the first page of the group after it, so the bar never dead-ends.
export function trackNav(menu, pageId) {
  const groups = menu?.groups || []
  const gi = groups.findIndex((g) => g.id === TRACK_GROUP)
  const pages = groups[gi]?.pages || []
  const i = pages.findIndex((p) => p.id === pageId)
  if (i < 0) return { prev: null, next: null }
  const after = groups.slice(gi + 1).find((g) => g.pages.length)
  return { prev: pages[i - 1] || null, next: pages[i + 1] || after?.pages[0] || null }
}

const open = (id) => go(`#/docs/${encodeURIComponent(id)}`)

export default function Track({ menu, pageId, seen }) {
  const groups = menu?.groups || []
  const track = groups.find((g) => g.id === TRACK_GROUP)
  if (!track) return null
  const done = track.pages.filter((p) => seen.includes(p.id)).length
  return (
    <div className="track">
      <div className="docs-group-head">{track.label}</div>
      <div
        className="track-prog"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={track.pages.length}
        aria-valuenow={done}
      >
        <i style={{ width: `${(done / (track.pages.length || 1)) * 100}%` }} />
      </div>
      {track.pages.map((p, i) => {
        const state = p.id === pageId ? 'on' : seen.includes(p.id) ? 'done' : ''
        return (
          <button
            key={p.id}
            className={`track-step ${state}`}
            aria-current={state === 'on' ? 'page' : undefined}
            onClick={() => open(p.id)}
          >
            <span className="track-n">{state === 'done' ? '✓' : i + 1}</span>
            <span>{p.title}</span>
          </button>
        )
      })}
      <div className="docs-group-head track-after">After the track</div>
      {groups
        .filter((g) => g.id !== TRACK_GROUP && g.pages.length)
        .map((g) => (
          <button key={g.id} className="track-link" onClick={() => open(g.pages[0].id)}>
            {g.label} <span className="mono dim">{g.pages.length}</span>
          </button>
        ))}
    </div>
  )
}

export function TrackBar({ menu, pageId }) {
  const { prev, next } = trackNav(menu, pageId)
  if (!prev && !next) return null
  return (
    <div className="track-bar">
      {prev ? (
        <button className="btn ghost sm" onClick={() => open(prev.id)}>
          ← {prev.title}
        </button>
      ) : (
        <span />
      )}
      {next && (
        <button className="btn sm" onClick={() => open(next.id)}>
          Next: {next.title} →
        </button>
      )}
    </div>
  )
}
