import React from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'

// One expandable row of the constitution table (Laws' LawRow: invariants, doctrine rules,
// the ethos): it lazy-loads its full body via /api/item/law/<addr> the first time it opens
// (cached on subsequent toggles) under a disclosure button. The row's columns, the doctrine
// toggle switch and the body renderer stay with the caller via props; this owns only the
// fetch/open lifecycle and the expand wrapper.
export default function CatalogRow({
  addr,
  isOpen,
  onToggle,
  className,
  style,
  head,
  toggleCol = null,
  renderBody,
  srcLine,
}) {
  const { data: detail } = useAsync(
    () => (isOpen ? api.item('law', addr) : Promise.resolve(null)),
    [isOpen, addr],
  )
  const expand = isOpen && (
    <div className="law-expand">
      {detail ? renderBody(detail) : <p className="dim">Loading…</p>}
      <div className="law-srcline">{srcLine}</div>
    </div>
  )
  // Doctrine rows expose two separate actions: the disclosure button opens/closes the rule
  // text, while the toggle switch is a sibling — so a switch click stages a selection
  // without also opening the rule it belongs to.
  if (toggleCol) {
    return (
      <>
        <div className={className} style={style} data-addr={addr}>
          <button className="law-disclosure" onClick={onToggle} aria-expanded={isOpen}>
            {head}
          </button>
          <span className="toggle-col">{toggleCol}</span>
        </div>
        {expand}
      </>
    )
  }
  return (
    <>
      <button
        className={className}
        style={style}
        onClick={onToggle}
        aria-expanded={isOpen}
        data-addr={addr}
      >
        {head}
      </button>
      {expand}
    </>
  )
}
