import React, { useMemo, useEffect } from 'react'
import { api } from '../../api/index.js'
import { go } from '../../lib/router.js'
import { useAsync } from '../../hooks/useAsync.js'
import { useHarness, HARNESSES } from '../../hooks/useHarness.js'
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
function PageView({ pageId, harness, overview, onAction }) {
  const { data, error, loading } = useAsync(
    () => (pageId ? api.docsPage(pageId, harness) : Promise.resolve(null)),
    [pageId, harness],
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

// Which group contains a given page id. With the chip-bar showing all groups
// at once, the active chip is the one whose pages contain the current page.
function groupOfPage(menu, pageId) {
  if (!menu || !pageId) return null
  for (const g of menu.groups) {
    if (g.pages.some((p) => p.id === pageId)) return g
  }
  return null
}

export default function Docs({ page, query, overview, onAction }) {
  const [harness, setHarness] = useHarness()
  const { data: menu, error } = useAsync(() => api.docs(harness), [harness])
  const pageId = page || defaultPageId(menu)

  // Switching harness (or a deep link) can land on a page the active harness
  // hides — the server still renders it, but the menu wouldn't list it. Send
  // such a page back to the default so the list and the pane stay in sync.
  useEffect(() => {
    if (!menu || !pageId) return
    const visible = menu.groups.some((g) => g.pages.some((p) => p.id === pageId))
    if (!visible) {
      const def = defaultPageId(menu)
      if (def && def !== pageId) go(`#/docs/${encodeURIComponent(def)}`)
    }
  }, [menu, pageId])
  const activeGroup = groupOfPage(menu, pageId) || menu?.groups?.[0]
  const q = (query || '').toLowerCase().trim()

  // With a query, the master list scopes across every group so search stays
  // discoverable (group headers appear so it's clear where each result
  // lives). Without a query, scope to just the active group's pages — the
  // chip-bar already surfaces the other groups one click away.
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

  const allGroups = menu?.groups || []
  const showGroupHeaders = !!q
  const switchGroup = (g) => {
    const first = g.pages[0]?.id
    if (first) go(`#/docs/${encodeURIComponent(first)}`)
  }

  return (
    <>
      <div className="head-row mb-16">
        <div>
          <div className="eyebrow">documentation</div>
          <h1 className="h">Docs</h1>
          <p className="sub">
            Concept pages, a generated CLI reference, and a glossary. Pages and config that
            differ by host are filtered to your selected harness.
          </p>
        </div>
        {/* Harness selector — filters the menu and per-page config to the chosen
            host (OpenCode vs Claude Code). Persists across reloads. Same .seg
            control the Dashboard uses, so the two surfaces feel coherent. */}
        <div className="seg" role="group" aria-label="Harness">
          {HARNESSES.map((h) => (
            <button
              key={h.id}
              className={harness === h.id ? 'on' : ''}
              onClick={() => setHarness(h.id)}
              aria-pressed={harness === h.id}
            >
              {h.label}
            </button>
          ))}
        </div>
      </div>
      {/* Horizontal group chip-bar — same pattern as Library's section bar so
          the two surfaces feel coherent. Active chip = group of the current
          page; each chip carries its page count. */}
      <div className="lib-secbar">
        {allGroups.map((g) => (
          <button
            key={g.id}
            className={`lib-secchip ${activeGroup?.id === g.id ? 'on' : ''}`}
            onClick={() => switchGroup(g)}
          >
            <span>{g.label}</span>
            <span className="lib-secchip-n">{g.pages.length}</span>
          </button>
        ))}
      </div>
      <div className="lib lib-2">
        <div className="card lib-main">
          <div className="lib-head">
            <span className="lib-head-label">{q ? 'all groups' : activeGroup?.label || ''}</span>
            <span className="lib-head-count">
              {groups.reduce((s, g) => s + g.pages.length, 0)} pages
            </span>
          </div>
          <div className="lib-rows">
            {groups.map((g) => (
              <div key={g.id} className="docs-group">
                {showGroupHeaders && <div className="docs-group-head">{g.label}</div>}
                {g.pages.map((p) => (
                  <button
                    key={p.id}
                    className={`lib-row ${pageId === p.id ? 'on' : ''}`}
                    onClick={() => go(`#/docs/${encodeURIComponent(p.id)}`)}
                  >
                    <div className="lr-name">{p.title}</div>
                    {p.date ? <div className="lr-desc">{p.date}</div> : null}
                  </button>
                ))}
              </div>
            ))}
            {groups.length === 0 && menu && (
              <div className="empty" style={{ padding: 32 }}>
                <div className="big">No matches</div>
                Try another search.
              </div>
            )}
            {!menu && <Loading label="Loading docs…" />}
          </div>
        </div>
        <div className="card lib-detail">
          <PageView pageId={pageId} harness={harness} overview={overview} onAction={onAction} />
        </div>
      </div>
    </>
  )
}
