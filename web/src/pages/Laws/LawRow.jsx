import CatalogRow from '../../components/CatalogRow.jsx'
import Markdown from '../../components/Markdown.jsx'

// One expandable row of the constitution table, shared by all three tiers via CatalogRow
// (the lazy-load/expand-panel machinery). The address is the catalog's `name`: a Roman
// numeral, `<pack>.<n>` or `ont:<id>`; `no` is what the No. column prints. `rev` is the
// page's data revision, so a rebuild does not serve a cached body. `after` closes the open panel.
export default function LawRow({ law, isOpen, onToggle, rev, toggleCol = null, after = null }) {
  const enfTone = law.enf === 'Hook gate' ? ' hook' : law.enf === 'Gate off' ? ' gate-off' : ''
  // Each `data-col` cell has a twin of the same name in the band's header row (`colHead`), so a
  // container query drops a column from both at once. What a dropped column held reappears in
  // the rule cell as a `law-fold` line: decorative there, the row's label already reads it.
  // With switches (`toggleCol` = [Rule text, Hook gate] cells), Enforced by leaves the disclosure
  // button and sits between them: a switch cannot live inside a button, and the columns read
  // Status, Rule text, Enforced by, Hook gate. There it is hidden from assistive tech: the button's
  // label already reads it.
  const enf = (
    <span
      key="enf"
      className={`law-enf${enfTone}`}
      data-col="enf"
      aria-hidden={toggleCol ? 'true' : undefined}
    >
      {law.enf}
    </span>
  )
  const head = (
    <>
      <span className="law-no" data-col="no">
        <span className="x" aria-hidden="true">
          ›
        </span>
        {law.no}
      </span>
      <span className="law-name">
        <span>{law.name}</span>
        {law.ess ? <span className="law-princ">{law.ess}</span> : null}
        {law.asks ? <span className="law-asks mono">{law.asks}</span> : null}
        {law.note ? <span className="law-note">{law.note}</span> : null}
        {law.no ? (
          <span className="law-fold law-fold-no" aria-hidden="true">
            <span className="x">›</span>
            {law.no}
          </span>
        ) : null}
        {law.latin ? (
          <span className="law-fold law-fold-latin" aria-hidden="true">
            {law.latin}
          </span>
        ) : null}
        <span className="law-fold law-fold-chips" aria-hidden="true">
          <span className={`law-chip-status ${law.statusTone}`}>{law.status}</span>
          <span className={`law-chip-enf${enfTone}`}>{law.enf}</span>
        </span>
      </span>
      <span className="law-latin" data-col="latin">
        {law.latin}
      </span>
      <span className={`law-status ${law.statusTone}`} data-col="status">
        {law.status}
      </span>
      {toggleCol ? null : enf}
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
      toggleCol={toggleCol ? [toggleCol[0], enf, toggleCol[1]] : null}
      renderBody={(d) => <Markdown body={d.body || law.ess} links={d.links} />}
      srcLine={`$ geneseed law ${law.addr} · ${law.src}`}
      after={after}
    />
  )
}
