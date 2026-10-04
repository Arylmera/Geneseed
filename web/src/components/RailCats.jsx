import React from 'react'

// The selected rail entry's categories, nested under it in the rail: "All" plus one row per
// group (coloured dot, name, count), narrowing the list pane to one group, and one thin bar
// whose segments are each group's share. Shared by the Library (Skills → skill classes) and
// the Docs (a part → its sections), and rendered by the page right after the selected entry's
// link only, so Tab reaches the categories straight after their entry and a screen reader
// hears a list named for what it cuts ("Skill types", "Sections"). The rail marks its entry
// with aria-current (a link to a place); a category is a toggle over the list, not a place,
// so it says aria-pressed. Renders nothing for 0 or 1 group: a single row can't narrow
// anything.
export default function RailCats({ label, total, cats, cat, onChange }) {
  if (cats.length <= 1) return null
  const rows = [{ key: 'all', label: 'All', n: total, c: 'var(--text-3)' }, ...cats]
  return (
    <div className="rail-cats">
      <ul aria-label={label}>
        {rows.map(({ key, label: cl, n, c }) => (
          <li key={key}>
            <button
              type="button"
              className={cat === key ? 'on' : ''}
              aria-pressed={cat === key}
              style={{ '--cc': c }}
              onClick={() => onChange(key)}
            >
              <span className="cdot" aria-hidden="true" />
              <span className="rc-name">{cl}</span>
              <span className="mono dim">{n}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="rail-mix" aria-hidden="true">
        {cats.map(({ key, n, c }) => (
          <span
            key={key}
            className={cat === 'all' || cat === key ? '' : 'dim'}
            style={{ '--cc': c, flexGrow: n }}
          />
        ))}
      </div>
    </div>
  )
}

// A grouped list's groups as categories, in the order the list already shows them (first
// appearance, same as its `● GROUP` headings), each with its row count. Used where the groups
// have no colour of their own (Docs sections, Loops shelves): the accent, as on the headings.
export function groupsOf(rows) {
  const order = []
  const n = new Map()
  for (const r of rows) {
    if (!n.has(r.group)) order.push(r.group)
    n.set(r.group, (n.get(r.group) || 0) + 1)
  }
  return order.map((g) => ({ key: g, label: g, n: n.get(g), c: 'var(--accent)' }))
}
