import React, { useMemo, useEffect } from 'react'
import { api } from '../../api/index.js'
import { go } from '../../lib/router.js'
import { useAsync } from '../../hooks/useAsync.js'
import { useHarness, HARNESSES, docsHostOf } from '../../hooks/useHarness.js'
import Loading from '../../components/Loading.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import MarkdownPage from './MarkdownPage.jsx'
import CliPage from './CliPage.jsx'
import Glossary from './Glossary.jsx'
import MapPage from './MapPage.jsx'
import Margin from './Margin.jsx'
import Track, { TrackBar, TRACK_GROUP, markSeen, readSeen } from './Track.jsx'
import About from './About.jsx'
import Seg from '../../components/Seg.jsx'

// Resolve a router page id to a default — empty hash lands on the first page
// of the first group so the right pane is never blank.
function defaultPageId(menu) {
  const first = menu?.groups?.[0]?.pages?.[0]
  return first?.id || ''
}

// One docs page rendered, dispatched by `kind`. Keeping the dispatch here
// keeps each sub-component focused on one shape — the same split the CLI
// uses to keep its topic submodules small. The page is fetched by the caller,
// which also feeds its body to the margin.
function PageView({ data, error, overview, onAction }) {
  if (error) return <ErrorState error={error} style={{ margin: 18 }} />
  if (!data) return <Loading label="Loading page…" />
  switch (data.kind) {
    case 'markdown':
    case 'concept':
      return <MarkdownPage page={data} overview={overview} onAction={onAction} />
    case 'map':
      return <MapPage page={data} overview={overview} onAction={onAction} />
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

// Which group contains a given page id — the one the sidebar treats as current.
function groupOfPage(menu, pageId) {
  if (!menu || !pageId) return null
  for (const g of menu.groups) {
    if (g.pages.some((p) => p.id === pageId)) return g
  }
  return null
}

export default function Docs({ page, query, overview, onAction }) {
  const [harness, setHarness] = useHarness(docsHostOf(overview?.emit))
  const { data: menu, error } = useAsync(() => api.docs(harness), [harness])
  const pageId = page || defaultPageId(menu)
  const {
    data: pageData,
    error: pageError,
    loading: pageLoading,
  } = useAsync(
    () => (pageId ? api.docsPage(pageId, harness) : Promise.resolve(null)),
    [pageId, harness],
  )
  // Fetched once per harness for the margin's term cards; a missing glossary just means
  // no cards, never an error on the page being read.
  const { data: glossary } = useAsync(
    () => api.docsPage('glossary', harness).catch(() => null),
    [harness],
    'docs:glossary',
  )

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
  const onTrack = activeGroup?.id === TRACK_GROUP
  const q = (query || '').toLowerCase().trim()

  // Opening an understand page counts it as read — the track's progress and the
  // Overview's "New here?" card both read this. The render counts the open page
  // already, so storage is written after it without a second render.
  useEffect(() => {
    if (onTrack && pageData?.id === pageId) markSeen(pageId)
  }, [onTrack, pageData, pageId])
  const seen = onTrack ? [...readSeen(), pageId] : []

  // Without a query the sidebar lists every group with its pages (the Handbook);
  // with one it filters across all of them, matching a page by its own title or id
  // or by its group's label.
  const groups = useMemo(() => {
    if (!menu) return []
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
  }, [menu, q])

  if (error) return <ErrorState error={error} />

  return (
    <>
      <div className="head-row mb-16">
        <div>
          <div className="eyebrow">documentation</div>
          <h1 className="h">Docs</h1>
          <p className="sub">
            Start with Understand, then guides, concepts and reference. Pages and config that differ
            by host are filtered to your selected harness.
          </p>
        </div>
        {/* Harness selector — filters the menu and per-page config to the chosen
            host (OpenCode vs Claude Code). Persists across reloads. Same .seg
            control the Dashboard uses, so the two surfaces feel coherent. */}
        <Seg aria-label="Harness">
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
        </Seg>
      </div>
      <div className="docs-hb">
        <nav className="card docs-nav" aria-label="Docs pages">
          {onTrack && !q ? (
            <Track menu={menu} pageId={pageId} seen={seen} />
          ) : (
            groups.map((g) => (
              <div key={g.id} className="docs-group">
                <div className="docs-group-head">{g.label}</div>
                {g.pages.map((p) => (
                  <button
                    key={p.id}
                    className={`lib-row ${pageId === p.id ? 'on' : ''}`}
                    aria-current={pageId === p.id ? 'page' : undefined}
                    onClick={() => go(`#/docs/${encodeURIComponent(p.id)}`)}
                  >
                    <div className="lr-name">{p.title}</div>
                  </button>
                ))}
              </div>
            ))
          )}
          {groups.length === 0 && menu && (
            <div className="empty" style={{ padding: 32 }}>
              <div className="big">No matches</div>
              Try another search.
            </div>
          )}
          {!menu && <Loading label="Loading docs…" />}
        </nav>
        <div className="card docs-article">
          <PageView
            key={`${pageId}|${harness}`}
            data={pageLoading ? null : pageData}
            error={pageError}
            overview={overview}
            onAction={onAction}
          />
          {onTrack && !pageLoading && <TrackBar menu={menu} pageId={pageId} />}
        </div>
        {!pageLoading && <Margin body={pageData?.body} glossaryRows={glossary?.rows} />}
      </div>
    </>
  )
}
