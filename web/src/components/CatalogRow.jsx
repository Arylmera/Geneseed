import { useId } from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'

// One expandable row of the constitution table (Laws' LawRow: invariants, doctrine rules,
// the ethos): it lazy-loads its full body via /api/item/law/<addr> the first time it opens
// (cached on subsequent toggles, under the `law-item` key and the catalog's `rev`, so a rebuild
// or a theme change fetches afresh) under a disclosure button. A failed fetch says so, with a
// Retry. The row's columns, the doctrine toggle switch and the body renderer stay with the
// caller via props; this owns only the fetch/open lifecycle and the expand wrapper.
//
// `label` is the button's accessible name: without it a screen reader hears every column run
// together. The expand wrapper carries the id the button's `aria-controls` names; it exists only
// while open, so a closed row's `aria-controls` points at nothing, which ARIA allows.
export default function CatalogRow({
  addr,
  isOpen,
  onToggle,
  className,
  style,
  head,
  label,
  rev,
  toggleCol = null,
  renderBody,
  srcLine,
}) {
  const id = useId()
  const {
    data: detail,
    error,
    reload,
  } = useAsync(
    () => (isOpen ? api.item('law', addr) : Promise.resolve(null)),
    [isOpen, addr, rev],
    'law-item',
  )
  const expand = isOpen && (
    <div className="law-expand" id={id}>
      {error ? (
        <p>
          <span role="alert">{error}</span>{' '}
          <button type="button" className="btn ghost" onClick={reload}>
            Retry
          </button>
        </p>
      ) : detail ? (
        renderBody(detail)
      ) : (
        <p className="dim">Loading…</p>
      )}
      <div className="law-srcline">{srcLine}</div>
    </div>
  )
  const disclosure = {
    type: 'button',
    onClick: onToggle,
    'aria-expanded': isOpen,
    'aria-controls': id,
    'aria-label': label,
  }
  // Doctrine rows expose two separate actions: the disclosure button opens/closes the rule
  // text, while the toggle switch is a sibling — so a switch click stages a selection
  // without also opening the rule it belongs to.
  if (toggleCol) {
    return (
      <>
        <div className={className} style={style} data-addr={addr}>
          <button className="law-disclosure" {...disclosure}>
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
      <button className={className} style={style} data-addr={addr} {...disclosure}>
        {head}
      </button>
      {expand}
    </>
  )
}
