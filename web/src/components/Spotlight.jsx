import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { animate, stagger } from 'animejs'
import { motionOK, settle } from '../lib/motion.js'

const MAX_RESULTS = 24

// Rank a hit: title-prefix beats title-includes beats desc/name-includes. A
// lower score sorts first.
function score(entry, q) {
  const t = entry.title.toLowerCase()
  if (t.startsWith(q)) return 0
  if (t.includes(q)) return 1
  if (entry.hay.includes(q)) return 2
  return -1
}

// Grouped by kind FIRST (the entry's sortKey: Actions -2, Pages -1, then the Library
// sections, MCP, Docs), ranked by score inside each group: an action is the row a user
// came to run, so a docs title that happens to start with the query must not push it
// down. An empty query lists what needs no typing to be useful — the actions and the
// pages, uncapped (a fixed, short list) — and none of the items.
function filterAndRank(index, query) {
  const q = query.toLowerCase().trim()
  if (!index) return []
  if (!q) return index.filter((e) => e.sortKey < 0).sort((a, b) => a.sortKey - b.sortKey)
  const hits = []
  for (const e of index) {
    const s = score(e, q)
    if (s >= 0) hits.push({ e, s })
  }
  hits.sort((a, b) => a.e.sortKey - b.e.sortKey || a.s - b.s || a.e.title.localeCompare(b.e.title))
  // The cap is on the items only: a one-letter query matches most actions and pages, and a
  // shared cap would fill every slot with them and hide the items entirely.
  const ranked = hits.map((h) => h.e)
  const items = ranked.filter((e) => e.sortKey >= 0).slice(0, MAX_RESULTS)
  return ranked.filter((e) => e.sortKey < 0).concat(items)
}

// The matched run of the title, marked — the reason a row is in the list, visible without
// reading it. The whole query, case-insensitively, first occurrence only: that is exactly
// what `score` ranked the row on, so the mark never claims a match the ranking did not use.
function marked(title, query) {
  const q = query.trim().toLowerCase()
  const at = q ? title.toLowerCase().indexOf(q) : -1
  if (at < 0) return title
  return (
    <>
      {title.slice(0, at)}
      <mark className="spot-hit">{title.slice(at, at + q.length)}</mark>
      {title.slice(at + q.length)}
    </>
  )
}

// `loading` and `error` are about the fetched items only: Actions and Pages are in `index`
// from the first render, so the status rows sit BELOW them and only once there is a query.
export default function Spotlight({ query, index, loading, error, active, onActive, onPick }) {
  const results = useMemo(() => filterAndRank(index, query), [index, query])
  const containerRef = useRef(null)

  // The rows cascade in when the list first HAS rows — not on every keystroke, which
  // re-ranks and would re-deal the whole list under the user's typing.
  const hasRows = results.length > 0
  useLayoutEffect(() => {
    const rows = containerRef.current?.querySelectorAll('[data-spot-row]')
    if (!hasRows || !rows?.length || !motionOK()) return
    const anim = animate(rows, {
      opacity: [0, 1],
      translateY: [-4, 0],
      duration: 220,
      delay: stagger(18),
      ease: 'outQuart',
    })
    return settle(anim, 220 + 18 * rows.length)
  }, [hasRows])

  // Reset selection when results change so we never land on an out-of-range row.
  useEffect(() => {
    if (active >= results.length) onActive(0)
  }, [results, active, onActive])

  // Keep the active row visible inside the scrollable list.
  useEffect(() => {
    const el = containerRef.current?.querySelector(`[data-spot-row="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  // Group results by `kind` while preserving the ranked order — first kind we
  // see opens its group, runs grow until a different kind appears.
  const groups = []
  let current = null
  results.forEach((e, i) => {
    if (!current || current.kind !== e.kind) {
      current = { kind: e.kind, rows: [] }
      groups.push(current)
    }
    current.rows.push({ entry: e, index: i })
  })

  const typed = !!query.trim()

  return (
    <div
      className="spotlight"
      ref={containerRef}
      id="spotlight-list"
      role="listbox"
      aria-label="Search results"
    >
      {/* Keyed by kind AND first row: one kind can open two runs (skills, docs, skills), and
          a shared key left the first run's rows on screen after the next keystroke (VS-21). */}
      {groups.map((g) => (
        <div
          key={`${g.kind}-${g.rows[0].index}`}
          className="spot-group"
          role="group"
          aria-label={g.kind}
        >
          {/* The heading is the group's aria-label already; leaving it exposed would make a
              screen reader read every section name twice. */}
          <div className="spot-group-head" aria-hidden="true">
            {g.kind}
          </div>
          {g.rows.map(({ entry, index: i }) => (
            <div
              key={`${entry.route || entry.title}-${i}`}
              // The id `aria-activedescendant` on the input points at — this is the half that
              // makes the moving highlight audible.
              id={`spot-opt-${i}`}
              data-spot-row={i}
              role="option"
              aria-selected={i === active}
              className={`spot-row ${i === active ? 'on' : ''}`}
              onMouseDown={(ev) => {
                // mousedown fires before input blur — keeps the click from being
                // cancelled by the blur tearing down the dropdown first.
                ev.preventDefault()
                onPick(entry)
              }}
              onMouseEnter={() => onActive(i)}
            >
              <div className="spot-title">{marked(entry.title, query)}</div>
              {entry.desc ? <div className="spot-desc">{entry.desc}</div> : null}
            </div>
          ))}
        </div>
      ))}
      {/* `presentation` on the two status rows: a listbox may own `option`s and `group`s and
          nothing else, so a bare div here made every option below an invalid child. The
          emptiness is announced by the live region in Search instead, which is where a
          screen reader will actually hear it. */}
      {typed && error && (
        <div className="spot-empty" role="presentation">
          Could not load the search index — {error}
        </div>
      )}
      {typed && loading && !error && (
        <div className="spot-empty" role="presentation">
          Loading…
        </div>
      )}
      {typed && !loading && !error && results.length === 0 && (
        <div className="spot-empty" role="presentation">
          No matches for &ldquo;{query}&rdquo;.
        </div>
      )}
    </div>
  )
}

// Export the helper so the host can react to Enter/Arrow keys without re-running
// the filter. Keeps the keyboard logic in Search.jsx and the layout here.
export { filterAndRank }
