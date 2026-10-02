import React, { useMemo } from 'react'
import { extractToc } from './MarkdownPage.jsx'

const MAX_CARDS = 5
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The glossary rows whose term the body uses: a whole word, any case, a plural "s" allowed
// ("Skills" uses "skill"). A row answers to its themed word, its neutral word and its label,
// since a page may be written in either voice. Glossary order, at most five.
export function glossaryHits(body, rows) {
  const text = body || ''
  const hits = []
  for (const r of rows || []) {
    const terms = [...new Set([r.themed, r.neutral, r.label].filter(Boolean))]
    const used = terms.some((t) =>
      new RegExp(`(?<![\\w-])${escape(t)}s?(?![\\w-])`, 'i').test(text),
    )
    if (used) hits.push(r)
    if (hits.length === MAX_CARDS) break
  }
  return hits
}

const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

// The Handbook's right margin: the page's own outline, then a card for each glossary term
// it uses, so no invented word goes unexplained.
export default function Margin({ body, glossaryRows }) {
  const toc = useMemo(() => extractToc(body), [body])
  const cards = useMemo(() => glossaryHits(body, glossaryRows), [body, glossaryRows])
  if (!toc.length && !cards.length) return null
  return (
    <aside className="docs-margin">
      {toc.length > 0 && (
        <nav className="docs-toc" aria-label="On this page">
          <div className="docs-toc-head">On this page</div>
          <ul>
            {toc.map((t) => (
              <li key={t.id} className={`lvl-${t.level}`}>
                <a
                  href={`#${t.id}`}
                  onClick={(e) => {
                    e.preventDefault()
                    jump(t.id)
                  }}
                >
                  {t.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {cards.length > 0 && (
        <div className="docs-gloss">
          <div className="docs-toc-head">Terms on this page</div>
          {cards.map((r) => (
            <div key={r.label} className="docs-gloss-card">
              <b>{r.themed || r.neutral || r.label}</b>
              <p>{r.desc}</p>
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}
