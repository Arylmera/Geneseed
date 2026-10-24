import React from 'react'

// A semantic table the way the hand-rolled ones were not always: a <caption> names it for a
// screen reader (`captionHidden` keeps it off screen when a heading above already says it),
// every header is scope="col", and the wrapper scrolls sideways so a wide table never pushes
// the page past the viewport on a phone. `columns` is [{ key, label, render?, align? }];
// `render(row)` overrides `row[key]`. `rowAction(row)` adds one trailing cell (a button,
// a menu). No virtualisation: no table here is long enough to need it.
export default function DataTable({ caption, captionHidden, columns, rows, rowKey, rowAction }) {
  const align = (c) => (c.align ? { textAlign: c.align } : undefined)
  return (
    <div className="tbl-scroll">
      <table className="tbl">
        <caption className={captionHidden ? 'sr-only' : 'tbl-caption'}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" style={align(c)}>
                {c.label}
              </th>
            ))}
            {rowAction ? (
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c) => (
                <td key={c.key} style={align(c)}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
              {rowAction ? <td className="tbl-act">{rowAction(r)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
