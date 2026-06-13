import React, { useEffect, useMemo, useRef } from 'react'
import { marked } from 'marked'
import { go } from '../../lib/router.js'

// Slugify a heading title into a stable id we can also use as a CSS anchor.
// Always returns a value that is safe inside `id="..."` AND inside a CSS
// `#<id>` selector — never empty, never starting with a digit/dash. Headings
// can be unicode-heavy ("## 中文") or formatting-heavy ("## **Bold**"), and a
// fragile slug used to flow straight into querySelector — which is what threw
// "The string did not match the expected pattern" in WebKit.
function slug(s, fallbackIdx = 0) {
  const cleaned = String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (cleaned && /^[a-z]/.test(cleaned)) return cleaned
  return `h-${fallbackIdx}-${cleaned || 'section'}`
}

// querySelector that swallows DOMExceptions from invalid selectors — the page
// shouldn't take down the right pane just because one heading slug came out
// shaped weird.
function safeQuery(root, selector) {
  if (!root || !selector) return null
  try {
    return root.querySelector(selector)
  } catch {
    return null
  }
}

// Pull the H2/H3 outline from the markdown source so the TOC can anchor-link
// even before the HTML is parsed. We skip code blocks (``` fences) to avoid
// catching hashes inside snippets. Each entry's `id` matches the id the
// post-mount pass assigns to the rendered heading.
function extractToc(body) {
  const out = []
  let inFence = false
  let idx = 0
  for (const ln of (body || '').split('\n')) {
    if (ln.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = ln.match(/^(##|###)\s+(.+?)\s*$/)
    if (m) {
      idx += 1
      out.push({ level: m[1].length, title: m[2], id: slug(m[2], idx) })
    }
  }
  return out
}

// Render the markdown body and turn [[name]] wikilinks into hash-router
// links. We deliberately don't override marked's renderer for headings —
// instead we walk the DOM after mount and assign ids there. That keeps us
// off the renderer-API churn between marked minor versions and means a weird
// heading can never poison the parser.
function renderHtml(body, links) {
  const byLabel = new Map((links || []).map((l) => [l.label, l]))
  const withLinks = (body || '').replace(/\[\[([^\]]+)\]\]/g, (m, label) => {
    const l = byLabel.get(label.trim())
    if (!l) return m
    return `[${l.label}](#/item/${l.type}/${encodeURIComponent(l.name)})`
  })
  return marked.parse(withLinks, { breaks: false })
}

// State-aware overlay: when this page is the Setup page and we know the
// deployed `emit` mode, highlight that path's heading so the user sees which
// row applies to their install at a glance.
const SETUP_ANCHOR_BY_EMIT = {
  'opencode-global': 'path-a-opencode-global-recommended',
  'opencode-per-repo': 'path-b-opencode-per-repo',
  'claude-code': 'path-c-claude-code',
  'agent-md': 'path-d-any-agentmd-tool',
  'bundle': 'path-d-any-agentmd-tool',
}

export default function MarkdownPage({ page, overview, onAction }) {
  const ref = useRef(null)
  const toc = useMemo(() => extractToc(page.body), [page.body])
  const html = useMemo(() => renderHtml(page.body, page.links), [page.body, page.links])

  // After the markdown lands in the DOM, assign id="..." to each h1/h2/h3
  // based on slug(textContent). One pass per render — matches the TOC's
  // numbering by walking in the same order extractToc did.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let idx = 0
    el.querySelectorAll('h1, h2, h3').forEach((h) => {
      idx += 1
      if (!h.id) {
        const id = slug(h.textContent || '', idx)
        if (id) h.id = id
      }
    })
  }, [html])

  // Internal-link / try-this handling. The Markdown component already converts
  // [[..]] to hash links; we just need to intercept clicks so we don't trigger
  // a full page navigation for #/ routes (the SPA already handles them via
  // hashchange).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onClick = (e) => {
      const a = e.target.closest('a[href]')
      if (!a) return
      const href = a.getAttribute('href')
      if (href && href.startsWith('#/')) {
        e.preventDefault()
        go(href)
      }
    }
    el.addEventListener('click', onClick)
    return () => el.removeEventListener('click', onClick)
  }, [html])

  // Scroll to the page's declared anchor (e.g. README "install" section) once
  // the HTML is in the DOM. Wrapped in safeQuery so a future bad anchor can
  // never throw past us.
  useEffect(() => {
    const target = page.anchor
    if (!target) return
    const el = safeQuery(ref.current, `#${CSS.escape(target)}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [html, page.anchor])

  // Setup page overlay: outline the path heading that matches the deployed
  // emit mode, so the docs read as a status surface for free.
  useEffect(() => {
    const el = ref.current
    if (!el || page.id !== 'setup') return
    el.querySelectorAll('.docs-here').forEach((n) => n.classList.remove('docs-here'))
    const anchor = SETUP_ANCHOR_BY_EMIT[overview?.emit]
    if (!anchor) return
    const h = safeQuery(el, `#${CSS.escape(anchor)}`)
    if (h) h.classList.add('docs-here')
  }, [html, page.id, overview?.emit])

  const onJump = (id) => {
    if (!id) return
    const el = safeQuery(ref.current, `#${CSS.escape(id)}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const showToc = toc.length >= 3

  // "Try this" buttons — wired only for pages where a safe action is obvious.
  const tryActions = []
  if (page.id === 'setup') {
    tryActions.push({ label: 'Run doctor', action: 'doctor' })
    tryActions.push({ label: 'Rebuild', action: 'build' })
  }
  if (page.id === 'verify') tryActions.push({ label: 'Run doctor', action: 'doctor' })
  if (page.id === 'self-improve') tryActions.push({ label: 'Open diff', hash: '#/diff' })

  return (
    <div className="detail-doc">
      <span className="eyebrow">docs</span>
      <h1 style={{ marginTop: 10 }}>{page.title}</h1>
      {page.source && (
        <div className="doc-meta">
          <span className="badge">
            <span className="dot" />
            {page.source}
          </span>
        </div>
      )}
      {tryActions.length > 0 && (
        <div className="row wrap gap-10" style={{ margin: '10px 0 14px' }}>
          {tryActions.map((t) =>
            t.hash ? (
              <a key={t.label} className="btn ghost sm" href={t.hash}>
                {t.label}
              </a>
            ) : (
              <button
                key={t.label}
                className="btn ghost sm"
                onClick={() => onAction && onAction(t.action)}
              >
                {t.label}
              </button>
            ),
          )}
        </div>
      )}
      {showToc && (
        <div className="docs-toc">
          <div className="docs-toc-head">On this page</div>
          <ul>
            {toc.map((t) => (
              <li key={t.id} className={`lvl-${t.level}`}>
                <a
                  href={`#${t.id}`}
                  onClick={(e) => {
                    e.preventDefault()
                    onJump(t.id)
                  }}
                >
                  {t.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="markdown" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
      {page.link && (
        <div style={{ marginTop: 24 }}>
          <a className="btn soft sm" href={page.link.hash}>
            {page.link.label}
          </a>
        </div>
      )}
    </div>
  )
}
