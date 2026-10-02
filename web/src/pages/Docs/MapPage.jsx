import React, { useState } from 'react'
import { marked } from 'marked'
import Markdown, { sanitizeHtml } from '../../components/Markdown.jsx'
import MarkdownPage from './MarkdownPage.jsx'

// Enforced and automatic run as code; asked and on-demand rely on the model reading prose.
const TONE = { enforced: 'ok', automatic: 'ok', asked: 'warn', 'on demand': 'warn' }

// The body split around the map table: its rows are drawn as the list in its place, so the
// table would say everything twice. Only the table whose header opens on "Piece" goes; any
// other table in the prose stays. No map table → everything is "before".
export function splitAtMapTable(body) {
  const before = []
  const after = []
  let state = 'before'
  for (const ln of (body || '').split('\n')) {
    if (state === 'before' && /^\|\s*piece\s*\|/i.test(ln)) state = 'map'
    else if (state === 'map' && !ln.trimStart().startsWith('|')) state = 'after'
    if (state === 'before') before.push(ln)
    else if (state === 'after') after.push(ln)
  }
  return [before.join('\n'), after.join('\n')]
}

// A table cell is inline markdown (`AGENT.md`, *lean*), so render it as such.
const Inline = ({ text }) => (
  <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(marked.parseInline(text || '')) }} />
)
const Chip = ({ kind }) => <span className={`tag ${TONE[kind] || ''}`}>{kind}</span>

// "What lands on your machine" as a map: the page's own table, parsed server-side, drawn
// as a clickable list with a detail panel for the selected piece. No rows (a table that
// failed to parse) falls back to the plain page, which still shows the table.
export default function MapPage({ page, overview, onAction }) {
  const [sel, setSel] = useState(0)
  if (!page.rows) return <MarkdownPage page={page} overview={overview} onAction={onAction} />
  const row = page.rows[sel] || page.rows[0]
  const [before, after] = splitAtMapTable(page.body)
  return (
    <div className="detail-doc">
      <h1 style={{ marginTop: 0 }}>{page.title}</h1>
      <Markdown body={before} links={page.links} />
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
            <h3 style={{ margin: '0 0 8px' }}>
              <Inline text={row.piece} />
            </h3>
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
      {after.trim() && <Markdown body={after} links={page.links} />}
    </div>
  )
}
