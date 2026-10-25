import React, { useMemo } from 'react'
import { renderDoc } from './headings.js'
import { cmdId } from './CliPage.jsx'
import { useOnScroll } from './scroll.js'
import { motionOK } from '../../lib/motion.js'

const MAX_CARDS = 5
const SPY_TOP = 96
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

// A jump moves focus too, or the next Tab returns to the outline instead of going on into the
// section (DC-8); tabindex -1 lets a heading take focus without becoming a tab stop. The
// scroll asks motionOK(): a JS `behavior` option is beyond the CSS reduced-motion override.
const jump = (id) => {
  const el = document.getElementById(id)
  if (!el) return
  el.setAttribute('tabindex', '-1')
  el.scrollIntoView({ behavior: motionOK() ? 'smooth' : 'auto' })
  el.focus({ preventScroll: true })
}

// The Handbook's right margin: the page's own outline, then a card for each glossary term
// it uses, so no invented word goes unexplained. The outline is renderDoc's, over the same
// page the reader pane renders, so each entry lands on an id the page carries.
export default function Margin({ page, glossaryRows }) {
  const body = page?.body
  // A CLI page has no markdown body: its outline is its commands.
  const toc = useMemo(
    () =>
      page?.kind === 'cli'
        ? (page.commands || []).map((c) => ({ id: cmdId(c.name), title: c.name, level: 2 }))
        : renderDoc(page).toc,
    [page],
  )
  const cards = useMemo(() => glossaryHits(body, glossaryRows), [body, glossaryRows])
  // Scroll spy: the entry being read is the last heading whose top has reached ~96px from
  // the viewport top (under the topbar); before the first one, none.
  const cur = useOnScroll(() => {
    let at = null
    for (const t of toc) {
      const top = document.getElementById(t.id)?.getBoundingClientRect().top
      if (top != null && top <= SPY_TOP) at = t.id
    }
    return at
  })
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
                  aria-current={cur === t.id ? 'location' : undefined}
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
