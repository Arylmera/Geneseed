import React, { useMemo } from 'react'
import { api } from '../../api/index.js'
import { go } from '../../lib/router.js'
import { useAsync } from '../../hooks/useAsync.js'
import Loading from '../../components/Loading.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import MarkdownPage from './MarkdownPage.jsx'
import CliPage from './CliPage.jsx'
import Glossary from './Glossary.jsx'
import About from './About.jsx'

// Resolve a router page id to a default — empty hash lands on the first page
// of the first group so the right pane is never blank.
function defaultPageId(menu) {
  const first = menu?.groups?.[0]?.pages?.[0]
  return first?.id || ''
}

// One docs page rendered, dispatched by `kind`. Keeping the dispatch here
// keeps each sub-component focused on one shape — the same split harness.py
// uses to keep its topic submodules small.
function PageView({ pageId, overview, onAction }) {
  const { data, error, loading } = useAsync(
    () => (pageId ? api.docsPage(pageId) : Promise.resolve(null)),
    [pageId],
  )
  if (error) return <ErrorState error={error} style={{ margin: 18 }} />
  if (loading || !data) return <Loading label="Loading page…" />
  switch (data.kind) {
    case 'markdown':
    case 'concept':
      return <MarkdownPage page={data} overview={overview} onAction={onAction} />
    case 'cli':
      return <CliPage page={data} />
    case 'glossary':
      return <Glossary page={data} />
    case 'about':
      return <About page={data} />
    default:
      return (
        <div className="empty">
          <div className="big">Unknown page kind</div>
          {data.kind}
        </div>
      )
  }
}

export default function Docs({ page, query, overview, onAction }) {
  const { data: menu, error } = useAsync(() => api.docs(), [])
  const pageId = page || defaultPageId(menu)

  // Filter the left sub-nav by the topbar query so search is scoped to docs.
  // A group survives if any of its pages matches; empty groups are hidden.
  const groups = useMemo(() => {
    if (!menu) return []
    const q = (query || '').toLowerCase().trim()
    if (!q) return menu.groups
    return menu.groups
      .map((g) => ({
        ...g,
        pages: g.pages.filter(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            g.label.toLowerCase().includes(q) ||
            p.id.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.pages.length > 0)
  }, [menu, query])

  if (error) return <ErrorState error={error} />

  return (
    <>
      <div className="head-row mb-18">
        <div>
          <span className="eyebrow">learn</span>
          <h1 className="h">Documentation</h1>
          <p className="sub">
            Everything Geneseed ships with — concepts, every CLI subcommand, every install path,
            the design history, and a glossary in your deployed voice. Auto-discovered from the
            repo so it stays current.
          </p>
        </div>
      </div>
      <div className="lib">
        <div className="card lib-list">
          <div className="lib-rows" style={{ maxHeight: 'calc(100vh - 220px)' }}>
            {groups.map((g) => (
              <div key={g.id} className="docs-group">
                <div className="docs-group-head">{g.label}</div>
                {g.pages.map((p) => (
                  <div
                    key={p.id}
                    className={`lib-row ${pageId === p.id ? 'on' : ''}`}
                    onClick={() => go(`#/docs/${encodeURIComponent(p.id)}`)}
                  >
                    <div className="lr-name">{p.title}</div>
                    {p.date ? <div className="lr-desc">{p.date}</div> : null}
                  </div>
                ))}
              </div>
            ))}
            {groups.length === 0 && (
              <div className="empty">
                <div className="big">No matches</div>Try another search.
              </div>
            )}
          </div>
        </div>
        <div className="card">
          <PageView pageId={pageId} overview={overview} onAction={onAction} />
        </div>
      </div>
    </>
  )
}
