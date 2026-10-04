import React from 'react'
import { go } from '../../lib/router.js'

// Where a docs page sits, and the prev/next bar under it. Every page has a part (the folder:
// Understand, Guides, Concepts, Reference) and a section inside it (`section:` frontmatter,
// General when absent); the menu already lists a part's pages section by section.
//
// The Understand part is also a course: its progress is the reader's own, in localStorage
// only — the ids of the understand pages they have opened. The Overview's "New here?" card
// reads the same key.
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

// The page's part, section and page record, or nulls when the menu does not list it.
export function placeOf(menu, pageId) {
  for (const part of menu?.groups || []) {
    const page = part.pages.find((p) => p.id === pageId)
    if (page) return { part, section: page.section || 'General', page }
  }
  return { part: null, section: null, page: null }
}

// Previous / Next: within the page's section — except on the Understand track, which is read
// as one course across its sections and leaves for the next part at its end (trackNav).
export function pageNav(menu, pageId) {
  const { part, section } = placeOf(menu, pageId)
  if (!part) return { prev: null, next: null }
  if (part.id === TRACK_GROUP) return trackNav(menu, pageId)
  const pages = part.pages.filter((p) => (p.section || 'General') === section)
  const i = pages.findIndex((p) => p.id === pageId)
  return { prev: pages[i - 1] || null, next: pages[i + 1] || null }
}

const open = (id) => go(`#/docs/${encodeURIComponent(id)}`)

// The track's progress line: how many understand pages the reader has opened.
export function TrackProgress({ pages, seen }) {
  const done = pages.filter((p) => seen.includes(p.id)).length
  return (
    <div
      className="track-prog"
      role="progressbar"
      aria-label="Pages read"
      aria-valuemin={0}
      aria-valuemax={pages.length}
      aria-valuenow={done}
    >
      <i style={{ width: `${(done / (pages.length || 1)) * 100}%` }} />
    </div>
  )
}

export function PageBar({ menu, pageId }) {
  const { prev, next } = pageNav(menu, pageId)
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
