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

// Which group contains a given page id. With the rail showing one group at a
// time, the in-page sub-nav follows: it scopes to the active page's group.
function groupOfPage(menu, pageId) {
  if (!menu || !pageId) return null
  for (const g of menu.groups) {
    if (g.pages.some((p) => p.id === pageId)) return g
  }
  return null
}

export default function Docs({ page, query, overview, onAction }) {
  const { data: menu, error } = useAsync(() => api.docs(), [])
  const pageId = page || defaultPageId(menu)
  const activeGroup = groupOfPage(menu, pageId) || menu?.groups?.[0]
  const q = (query || '').toLowerCase().trim()

  // The left column mirrors the page level: with no query, show ONLY the
  // active group's pages — the rail's sub-nav already surfaces the other
  // groups (same split as Library's section page). A query widens the scope
  // back across all groups so search stays discoverable; empty groups drop
  // out, and a group header appears so cross-group results read clearly.
  const groups = useMemo(() => {
    if (!menu) return []
    if (!q) return activeGroup ? [activeGroup] : []
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
  }, [menu, q, activeGroup])

  if (error) return <ErrorState error={error} />

  // With a query, the user is searching across all groups — keep the group
  // headers so it's clear where each result lives. Without a query, we're
  // focused on one group already (rail picked it), so suppress the header.
  const showGroupHeaders = !!q

  return (
    <>
      <div className="head-row mb-18">
        <div>
          <h1 className="h">{q ? 'Documentation' : activeGroup?.label || 'Documentation'}</h1>
          <p className="sub">
            {q
              ? `Searching all groups for "${q}".`
              : 'Pick a group from the left rail to switch the focus; pages within it appear in the sub-nav.'}
          </p>
        </div>
      </div>
      <div className="lib">
        <div className="card lib-list">
          <div className="lib-rows" style={{ maxHeight: 'calc(100vh - 220px)' }}>
            {groups.map((g) => (
              <div key={g.id} className="docs-group">
                {showGroupHeaders && <div className="docs-group-head">{g.label}</div>}
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
