import React, { useMemo } from 'react'
import { api } from '../../api/index.js'
import { go } from '../../lib/router.js'
import { useAsync } from '../../hooks/useAsync.js'
import Loading from '../../components/Loading.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import MarkdownPage from '../Docs/MarkdownPage.jsx'

// docsPage id for a given spec filename — the server prefixes specs with
// "spec:" so they share the docs renderer.
const pageIdFor = (filename) => `spec:${filename}`

// One row of the collapsible list. Lazy-loads its full markdown body the
// first time the user opens it via api.docsPage; subsequent toggles reuse
// the cached page. Renders through MarkdownPage so wikilink resolution and
// anchor handling match the Docs surface (DRY: one renderer, two places).
function SpecRow({ spec, isOpen, onToggle, overview }) {
  const { data, error } = useAsync(
    () => (isOpen ? api.docsPage(pageIdFor(spec.filename)) : Promise.resolve(null)),
    [isOpen, spec.filename],
  )
  return (
    <div className={`card spec-item ${isOpen ? 'open' : ''}`}>
      <button
        className="spec-row"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={`spec-body-${spec.filename}`}
      >
        <div className="spec-date mono">{spec.date || '—'}</div>
        <div className="spec-main">
          <div className="spec-name">{spec.title}</div>
          {spec.purpose && <div className="spec-purpose">{spec.purpose}</div>}
        </div>
        <span className={`spec-status spec-status-${spec.status || 'planned'}`}>
          <span className="dot" />
          {spec.status || 'planned'}
        </span>
        <span className="spec-chev" style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}>
          ›
        </span>
      </button>
      {isOpen && (
        <div className="spec-body" id={`spec-body-${spec.filename}`}>
          {error ? (
            <ErrorState error={error} style={{ margin: 18 }} />
          ) : data ? (
            <MarkdownPage page={data} overview={overview} />
          ) : (
            <Loading label="Loading spec…" />
          )}
        </div>
      )}
    </div>
  )
}

export default function Specs({ spec, query, overview }) {
  const { data, error } = useAsync(() => api.specs(), [])

  // Topbar search scopes the list — title, date, or purpose all hit.
  const shown = useMemo(() => {
    const all = data?.specs || []
    const q = (query || '').toLowerCase().trim()
    if (!q) return all
    return all.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.date || '').includes(q) ||
        (s.purpose || '').toLowerCase().includes(q),
    )
  }, [data, query])

  if (error) return <ErrorState error={error} />

  // The URL drives which spec is open. Toggling pushes a new hash so opening
  // a spec is bookmarkable and reflected in the back button.
  const openFilename = spec || ''
  const toggle = (filename) =>
    go(openFilename === filename ? '#/specs' : `#/specs/${encodeURIComponent(filename)}`)

  return (
    <>
      <div className="head-row mb-18">
        <div>
          <div className="eyebrow">implementation specs</div>
          <h1 className="h">Specs</h1>
          <p className="sub">
            Every dated implementation spec under <code>docs/specs/</code>, newest first. Click any
            row to expand it inline; the rationale and history of the feature lives in the markdown
            body.
          </p>
        </div>
      </div>
      <div className="spec-list">
        {shown.map((s) => (
          <SpecRow
            key={s.id}
            spec={s}
            isOpen={openFilename === s.filename}
            onToggle={() => toggle(s.filename)}
            overview={overview}
          />
        ))}
        {shown.length === 0 && (
          <div className="empty" style={{ padding: 32 }}>
            <div className="big">No specs</div>
            {data ? 'No matches for your search.' : 'docs/specs/ is empty.'}
          </div>
        )}
      </div>
    </>
  )
}
