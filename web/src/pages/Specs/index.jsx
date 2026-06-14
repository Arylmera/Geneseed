import React, { useMemo } from 'react'
import { api } from '../../api/index.js'
import { go } from '../../lib/router.js'
import { useAsync } from '../../hooks/useAsync.js'
import Loading from '../../components/Loading.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import MarkdownPage from '../Docs/MarkdownPage.jsx'

// Build the docs-page id the backend recognises for one spec ("spec:<file>").
// The router carries the bare filename, the API expects the prefix.
const pageIdFor = (filename) => `spec:${filename}`

// One spec rendered in the right pane — defers to MarkdownPage so the TOC,
// anchor handling, and wikilink resolution are identical to a Docs markdown
// page (DRY: one renderer, two surfaces).
function SpecDetail({ filename, overview }) {
  const { data, error, loading } = useAsync(
    () => (filename ? api.docsPage(pageIdFor(filename)) : Promise.resolve(null)),
    [filename],
  )
  if (error) return <ErrorState error={error} style={{ margin: 18 }} />
  if (!filename) {
    return (
      <div className="empty">
        <div className="big">Pick a spec</div>
        Choose one from the list to read it.
      </div>
    )
  }
  if (loading || !data) return <Loading label="Loading spec…" />
  return <MarkdownPage page={data} overview={overview} />
}

export default function Specs({ spec, query, overview }) {
  const { data, error } = useAsync(() => api.specs(), [])
  const filename = spec || ''

  // Topbar search scopes to the visible spec list — title, date, or the
  // first-paragraph purpose all hit. Matches the Docs page filter behaviour
  // so the same query feels consistent across Learn.
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

  return (
    <>
      <div className="head-row mb-18">
        <div>
          <h1 className="h">Specs</h1>
          <p className="sub">
            Every dated implementation spec under <code>docs/specs/</code>: the rationale and
            history behind each feature, newest first. Auto-discovered from the repo.
          </p>
        </div>
      </div>
      <div className="lib">
        <div className="card lib-list">
          <div className="lib-rows" style={{ maxHeight: 'calc(100vh - 220px)' }}>
            {shown.map((s) => (
              <div
                key={s.id}
                className={`lib-row ${filename === s.filename ? 'on' : ''}`}
                onClick={() => go(`#/specs/${encodeURIComponent(s.filename)}`)}
              >
                <div className="lr-name">{s.title}</div>
                <div className="lr-desc">
                  {s.date}
                  {s.purpose ? ` · ${s.purpose}` : ''}
                </div>
              </div>
            ))}
            {shown.length === 0 && (
              <div className="empty">
                <div className="big">No specs</div>
                {data ? 'No matches for your search.' : 'docs/specs/ is empty.'}
              </div>
            )}
          </div>
        </div>
        <div className="card">
          <SpecDetail filename={filename} overview={overview} />
        </div>
      </div>
    </>
  )
}
