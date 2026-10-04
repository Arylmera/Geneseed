import React, { useState, useEffect } from 'react'
import { api } from '../../api/index.js'
import { go } from '../../lib/router.js'
import { useAsync } from '../../hooks/useAsync.js'
import { useHarness, HARNESSES, docsHostOf } from '../../hooks/useHarness.js'
import Loading from '../../components/Loading.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import FilterInput from '../../components/FilterInput.jsx'
import { GroupedRows, walkRows, useActiveRowInView } from '../../components/LibRows.jsx'
import MarkdownPage from './MarkdownPage.jsx'
import CliPage from './CliPage.jsx'
import Glossary from './Glossary.jsx'
import MapPage from './MapPage.jsx'
import Margin from './Margin.jsx'
import { PageBar, TrackProgress, TRACK_GROUP, markSeen, placeOf, readSeen } from './Track.jsx'
import About from './About.jsx'
import Seg from '../../components/Seg.jsx'

const enc = encodeURIComponent
const docHref = (id) => `#/docs/${enc(id)}`

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

// A part's pages as list rows: a `● SECTION` heading each time the section changes (the menu
// already lists a part section by section), the page's description as the row's second line.
// Exported for the test that pins it.
export function docRows(part) {
  return (part?.pages || []).map((p) => ({
    name: p.id,
    title: p.title,
    desc: p.description || '',
    group: p.section || 'General',
    groupC: 'var(--accent)',
  }))
}

// The filter: title and description, as in the Library (plus the id, which is what a link
// to the page says).
export function filterRows(rows, q) {
  const ql = (q || '').trim().toLowerCase()
  if (!ql) return rows
  return rows.filter((r) => `${r.title} ${r.name} ${r.desc}`.toLowerCase().includes(ql))
}

// The Docs, in the Library's three panes: a rail of parts (the docs folders) with their page
// counts, the part's pages grouped by section, and the page with its breadcrumb, its outline
// in the margin and Previous / Next within its section. The address is still `#/docs/<id>`,
// so every cross-link, search hit and bookmark lands where it always did; a part is opened
// through its first page.
export default function Docs({ page, overview, onAction }) {
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
      if (def && def !== pageId) go(docHref(def))
    }
  }, [menu, pageId])

  // A page opens at its top. The scroller outlives the route, so without this the next page
  // would open wherever the last one was left. Which element scrolls depends on the layout:
  // `main#main` in the app shell, the document itself in the others — reset both.
  useEffect(() => {
    const doc = document.scrollingElement || document.documentElement
    for (const el of [document.getElementById('main'), doc]) {
      if (el) el.scrollTop = 0
    }
  }, [pageId])

  const place = placeOf(menu, pageId)
  const part = place.part || menu?.groups?.[0] || null
  const onTrack = part?.id === TRACK_GROUP

  // Opening an understand page counts it as read — the track's progress and the
  // Overview's "New here?" card both read this. The render counts the open page
  // already, so storage is written after it without a second render.
  useEffect(() => {
    if (onTrack && pageData?.id === pageId) markSeen(pageId)
  }, [onTrack, pageData, pageId])
  const seen = onTrack ? [...readSeen(), pageId] : []

  // Filter text belongs to one part: drop it when the open page moves to another.
  const [q, setQ] = useState('')
  const [seenPart, setSeenPart] = useState(part?.id)
  if (part?.id !== seenPart) {
    setSeenPart(part?.id)
    setQ('')
  }
  const rows = docRows(part)
  const shown = filterRows(rows, q)
  const rowsRef = useActiveRowInView([part?.id, pageId])

  if (error) return <ErrorState error={error} />

  return (
    <div className="docs-wrap">
      <div className="library docs-lib">
        <aside className="lib-kinds" aria-label="Docs parts">
          <div className="lib-title">
            <h1 className="h">Docs</h1>
            <span className="dim">How it works, and how to use it</span>
          </div>
          {/* Harness selector — filters the menu and per-page config to the chosen
            host (OpenCode vs Claude Code). Persists across reloads. */}
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
          <nav className="kind-list" aria-label="Parts">
            {(menu?.groups || []).map((g) => (
              <a
                key={g.id}
                href={g.pages[0] ? docHref(g.pages[0].id) : '#/docs'}
                className={part?.id === g.id ? 'on' : ''}
                aria-current={part?.id === g.id ? 'page' : undefined}
              >
                {g.label}
                <span className="mono dim">{g.pages.length}</span>
              </a>
            ))}
          </nav>
        </aside>

        <section className="lib-list" aria-label={part?.label || 'Docs'}>
          <div className="lib-list-head">
            <b>
              {part?.label}{' '}
              <span className="mono dim">
                {q.trim() ? `${shown.length} of ${rows.length}` : rows.length || ''}
              </span>
            </b>
            {onTrack && <TrackProgress pages={part.pages} seen={seen} />}
          </div>
          <FilterInput
            value={q}
            onChange={setQ}
            placeholder={`Filter ${(part?.label || 'docs').toLowerCase()}`}
            label={`Filter ${part?.label || 'docs'}`}
          />
          <div className="lib-rows" ref={rowsRef} onKeyDown={walkRows}>
            {!menu ? (
              <Loading label="Loading docs…" />
            ) : (
              <GroupedRows
                rows={shown}
                activeName={pageId}
                hrefOf={(r) => docHref(r.name)}
                pills={
                  onTrack
                    ? (r) =>
                        seen.includes(r.name) && r.name !== pageId ? (
                          <span className="docs-read-mark">
                            <span aria-hidden="true">✓</span>
                            <span className="sr-only">read</span>
                          </span>
                        ) : null
                    : undefined
                }
              />
            )}
            {q.trim() && shown.length === 0 && (
              <div className="empty" style={{ padding: 32 }}>
                <div className="big">No matches</div>
                Nothing in {(part?.label || 'docs').toLowerCase()} matches “{q.trim()}”.
              </div>
            )}
          </div>
        </section>

        <article className="lib-reader docs-reader" aria-label="Page">
          {place.page && (
            <nav className="docs-crumbs mono" aria-label="Breadcrumb">
              <a href={docHref(place.part.pages[0].id)}>{place.part.label}</a>
              <span aria-hidden="true">›</span>
              <a
                href={docHref(
                  place.part.pages.find((p) => (p.section || 'General') === place.section).id,
                )}
              >
                {place.section}
              </a>
              <span aria-hidden="true">›</span>
              <span aria-current="page">{place.page.title}</span>
            </nav>
          )}
          <div className="docs-read">
            <div className="docs-article">
              <PageView
                key={`${pageId}|${harness}`}
                data={pageLoading ? null : pageData}
                error={pageError}
                overview={overview}
                onAction={onAction}
              />
              {!pageLoading && <PageBar menu={menu} pageId={pageId} />}
            </div>
            {!pageLoading && <Margin body={pageData?.body} glossaryRows={glossary?.rows} />}
          </div>
        </article>
      </div>
    </div>
  )
}
