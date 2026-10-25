import React, { useMemo, useState } from 'react'
import { marked } from 'marked'
import { sanitizeHtml } from '../../components/Markdown.jsx'
import MarkdownPage, { minutesOf } from './MarkdownPage.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import { renderDoc } from './headings.js'

export { splitAtMapTable } from './headings.js'

// Enforced and automatic run as code; asked and on-demand rely on the model reading prose.
const TONE = { enforced: 'ok', automatic: 'ok', asked: 'warn', 'on demand': 'warn' }

// A table cell is inline markdown (`AGENT.md`, *lean*), so render it as such.
const Inline = ({ text }) => (
  <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(marked.parseInline(text || '')) }} />
)
const Chip = ({ kind }) => <span className={`tag ${TONE[kind] || ''}`}>{kind}</span>

// "What lands on your machine" as a map: the page's own table, parsed server-side, drawn
// as a clickable list with a detail panel for the selected piece. No rows (a table that
// failed to parse) falls back to the plain page, which still shows the table.
export default function MapPage({ page, overview, onAction, section, description }) {
  const [sel, setSel] = useState(0)
  // The prose around the list, with the same heading ids the margin's outline links to.
  const { before, after } = useMemo(() => renderDoc(page), [page])
  if (!page.rows)
    return (
      <MarkdownPage
        page={page}
        overview={overview}
        onAction={onAction}
        section={section}
        description={description}
      />
    )
  const row = page.rows[sel] || page.rows[0]
  return (
    <div className="detail-doc">
      <PageHeader
        eyebrow={section && `${section} · ${minutesOf(page.body)} min read`}
        title={page.title}
        sub={description}
      />
      <div className="markdown" dangerouslySetInnerHTML={{ __html: before }} />
      <div className="docs-map">
        <ul className="map-tree" aria-label="Pieces">
          {page.rows.map((r, i) => (
            <li key={i}>
              <button
                className={`map-node ${i === sel ? 'on' : ''}`}
                aria-pressed={i === sel}
                onClick={() => setSel(i)}
              >
                <span className="map-piece">
                  <Inline text={r.piece} />
                </span>
                <Chip kind={r.kind} />
                <span className="mono dim map-cost">
                  <Inline text={r.cost} />
                </span>
              </button>
            </li>
          ))}
        </ul>
        {row && (
          <div className="card pad-md map-detail" aria-live="polite">
            <h2>
              <Inline text={row.piece} />
            </h2>
            <Chip kind={row.kind} />
            <dl>
              <dt>Does</dt>
              <dd>
                <Inline text={row.does} />
              </dd>
              <dt>Costs</dt>
              <dd>
                <Inline text={row.cost} />
              </dd>
              <dt>Turn it off</dt>
              <dd>
                <Inline text={row.off} />
              </dd>
            </dl>
          </div>
        )}
      </div>
      {after.trim() && <div className="markdown" dangerouslySetInnerHTML={{ __html: after }} />}
    </div>
  )
}
