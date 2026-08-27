import React from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'

// One expandable catalog row, shared by Laws' LawRow (invariants + doctrine rules) and
// Skills' SkillRow: both lazy-load their full body via /api/item/<kind>/<addr> the first
// time they open (cached on subsequent toggles) and share the same disclosure-button +
// expand-panel shape. Per-page differences — the numeral column, the doctrine toggle
// switch, the body renderer (LawText vs full Markdown) — stay with the caller via props;
// this owns only the fetch/open lifecycle and the expand wrapper.
export default function CatalogRow({
  kind,
  addr,
  isOpen,
  onToggle,
  className,
  style,
  head,
  toggleCol = null,
  expandClassName = 'law-expand',
  renderBody,
  srcLine,
}) {
  const { data: detail } = useAsync(
    () => (isOpen ? api.item(kind, addr) : Promise.resolve(null)),
    [isOpen, addr],
  )
  const expand = isOpen && (
    <div className={expandClassName}>
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
        <div className={className} style={style}>
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
      <button className={className} style={style} onClick={onToggle} aria-expanded={isOpen}>
        {head}
      </button>
      {expand}
    </>
  )
}
