import React, { useEffect, useMemo, useRef } from 'react'
import { go } from '../lib/router.js'

const MAX_RESULTS = 24

// Rank a hit: title-prefix beats title-includes beats desc/name-includes. A
// lower score sorts first. We also break ties by the index entry's own sortKey
// so Library sections come before MCP/Docs/Specs.
function score(entry, q) {
  const t = entry.title.toLowerCase()
  if (t.startsWith(q)) return 0
  if (t.includes(q)) return 1
  if (entry.hay.includes(q)) return 2
  return -1
}

function filterAndRank(index, query) {
  const q = query.toLowerCase().trim()
  if (!q || !index) return []
  const hits = []
  for (const e of index) {
    const s = score(e, q)
    if (s >= 0) hits.push({ e, s })
  }
  hits.sort((a, b) => a.s - b.s || a.e.sortKey - b.e.sortKey || a.e.title.localeCompare(b.e.title))
  return hits.slice(0, MAX_RESULTS).map((h) => h.e)
}

export default function Spotlight({ query, index, loading, active, onActive, onClose }) {
  const results = useMemo(() => filterAndRank(index, query), [index, query])
  const containerRef = useRef(null)

  // Reset selection when results change so we never land on an out-of-range row.
  useEffect(() => {
    if (active >= results.length) onActive(0)
  }, [results, active, onActive])

  // Keep the active row visible inside the scrollable list.
  useEffect(() => {
    const el = containerRef.current?.querySelector(`[data-spot-row="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const open = (e) => {
    if (!e) return
    go(e.route)
    onClose()
  }

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

  if (!query.trim()) return null

  return (
    <div className="spotlight" ref={containerRef} role="listbox">
      {loading && !index && <div className="spot-empty">Loading…</div>}
      {!loading && results.length === 0 && index && (
        <div className="spot-empty">No matches for &ldquo;{query}&rdquo;.</div>
      )}
      {groups.map((g) => (
        <div key={g.kind} className="spot-group">
          <div className="spot-group-head">{g.kind}</div>
          {g.rows.map(({ entry, index: i }) => (
            <div
              key={`${entry.route}-${i}`}
              data-spot-row={i}
              role="option"
              aria-selected={i === active}
              className={`spot-row ${i === active ? 'on' : ''}`}
              onMouseDown={(ev) => {
                // mousedown fires before input blur — keeps the click from being
                // cancelled by the blur tearing down the dropdown first.
                ev.preventDefault()
                open(entry)
              }}
              onMouseEnter={() => onActive(i)}
            >
              <div className="spot-title">{entry.title}</div>
              {entry.desc ? <div className="spot-desc">{entry.desc}</div> : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// Export the helper so the host can react to Enter/Arrow keys without re-running
// the filter. Keeps the keyboard logic in Search.jsx and the layout here.
export { filterAndRank }
