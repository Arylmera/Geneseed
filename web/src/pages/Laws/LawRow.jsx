import React from 'react'
import CatalogRow from '../../components/CatalogRow.jsx'

// Tiny inline formatter: render `code` spans and *emphasis* in plain rule text.
// The full rule bodies are kept lightly marked-up in src/, so a minimal formatter is enough — we
// don't need the full Markdown renderer here.
function LawText({ text }) {
  const parts = String(text).split(/(`[^`]+`|\*[^*]+\*)/g)
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('`') && p.endsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>
        if (p.startsWith('*') && p.endsWith('*') && p.length > 2)
          return <em key={i}>{p.slice(1, -1)}</em>
        return <React.Fragment key={i}>{p}</React.Fragment>
      })}
    </>
  )
}

// One expandable row of the constitution table, shared by all three tiers via CatalogRow
// (the lazy-load/expand-panel machinery). The address is the catalog's `name`: a Roman
// numeral, `<pack>.<n>` or `ont:<id>`; `no` is what the No. column prints.
export default function LawRow({ law, isOpen, onToggle, toggleCol = null }) {
  const head = (
    <>
      <span className="law-no">
        <span className="x" aria-hidden="true">
          ›
        </span>
        {law.no}
      </span>
      <span className="law-name">
        <span>{law.name}</span>
        {law.ess ? <span className="law-princ">{law.ess}</span> : null}
      </span>
      <span className="law-latin">{law.latin}</span>
      <span className={`law-status ${law.statusTone}`}>{law.status}</span>
      <span
        className={`law-enf${law.enf === 'Hook gate' ? ' hook' : law.enf === 'Gate off' ? ' gate-off' : ''}`}
      >
        {law.enf}
      </span>
    </>
  )
  return (
    <CatalogRow
      addr={law.addr}
      isOpen={isOpen}
      onToggle={onToggle}
      className={`law-row${toggleCol ? ' has-toggle' : ''}${isOpen ? ' on' : ''}${law.off ? ' law-off' : ''}`}
      style={{ '--cc': law.c }}
      head={head}
      toggleCol={toggleCol}
      renderBody={(detail) => (
        <p>
          <LawText text={detail.body || law.ess} />
        </p>
      )}
      srcLine={`$ geneseed law ${law.addr} · ${law.src}`}
    />
  )
}
