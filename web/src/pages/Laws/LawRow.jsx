import CatalogRow from '../../components/CatalogRow.jsx'
import Markdown from '../../components/Markdown.jsx'

// One expandable row of the constitution table, shared by all three tiers via CatalogRow
// (the lazy-load/expand-panel machinery). The address is the catalog's `name`: a Roman
// numeral, `<pack>.<n>` or `ont:<id>`; `no` is what the No. column prints. `rev` is the
// page's data revision, so a rebuild does not serve a cached body.
export default function LawRow({ law, isOpen, onToggle, rev, toggleCol = null }) {
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
        {law.asks ? <span className="law-asks mono">{law.asks}</span> : null}
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
      label={`${law.no ? law.no + ' ' : ''}${law.name}, ${law.status}, ${law.enf}`}
      rev={rev}
      toggleCol={toggleCol}
      renderBody={(d) => <Markdown body={d.body || law.ess} links={d.links} />}
      srcLine={`$ geneseed law ${law.addr} · ${law.src}`}
    />
  )
}
