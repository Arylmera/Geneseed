import React, { useEffect, useMemo, useRef } from 'react'
import { go } from '../../lib/router.js'
import { renderMarkdown } from '../../components/Markdown.jsx'

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

// A heading's source as the reader sees it: links and wikilinks down to their text, code
// spans and bold/italic markers dropped. The outline used to print the raw source —
// backticks, asterisks, whole URLs. Single underscores stay: they are snake_case far more
// often than emphasis in these docs.
export function plainTitle(src) {
  return src
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*|__/g, '')
    .replace(/\*([^*\s][^*]*)\*/g, '$1')
}

// Pull the H2/H3 outline from the markdown source so the TOC can anchor-link
// even before the HTML is parsed. We skip code blocks (``` fences) to avoid
// catching hashes inside snippets. Each entry's `id` matches the id the
// post-mount pass assigns to the rendered heading.
export function extractToc(body) {
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
      out.push({ level: m[1].length, title: plainTitle(m[2]), id: slug(m[2], idx) })
    }
  }
  return out
}

// State-aware overlay. The install guide is a section of pages, one per host: the deployed
// emit names its host's page and, where that page has one heading per scope, the heading.
// On the Install hub the list item linking to the reader's page is lit; on the host page the
// scope's H2. Matched by link and by slug, so a page or heading that drifts simply goes unlit.
const INSTALL_BY_EMIT = {
  'opencode-global': ['install-opencode', 'Global (recommended)'],
  opencode: ['install-opencode', 'Per repo'],
  'claude-global': ['install-claude-code'],
  claude: ['install-claude-code'],
  'openclaude-global': ['install-openclaude'],
  openclaude: ['install-openclaude'],
  'bob-global': ['install-bob'],
  bob: ['install-bob'],
  files: ['install-agent-md'],
}

// A blockquote that opens on **You already know this:** is a dev analogy, styled as
// a box of its own (the Understand track introduces every term this way).
const ANALOGY_LEAD = 'you already know this'

export default function MarkdownPage({ page, overview, onAction }) {
  const ref = useRef(null)
  const html = useMemo(() => renderMarkdown(page.body, page.links), [page.body, page.links])

  // After the markdown lands in the DOM, assign id="..." to each h1/h2/h3
  // based on slug(textContent). One pass per render — matches the TOC's
  // numbering by walking in the same order extractToc did. We deliberately
  // don't override marked's renderer for headings — walking the DOM after
  // mount keeps us off the renderer-API churn between marked minor versions,
  // and means a weird heading can never poison the parser.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let idx = 0
    el.querySelectorAll('h1, h2, h3').forEach((h) => {
      if (h.tagName !== 'H1') idx += 1
      if (!h.id) {
        const id = slug(h.textContent || '', idx)
        if (id) h.id = id
      }
    })
    el.querySelectorAll('blockquote').forEach((q) => {
      const lead = (q.querySelector('strong')?.textContent || '').toLowerCase()
      if (lead.startsWith(ANALOGY_LEAD)) q.classList.add('analogy')
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

  // Install overlay: outline the reader's own path. Outline only — never scroll to it: the
  // page opens at its top like every other, and the reader finds their path lit.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.querySelectorAll('.docs-here').forEach((n) => n.classList.remove('docs-here'))
    const [target, heading] = INSTALL_BY_EMIT[overview?.emit] || []
    if (!target) return
    let lit = null
    if (page.id === 'install') {
      lit = el.querySelector(`a[href="#/docs/${target}"]`)?.closest('li')
    } else if (page.id === target && heading) {
      lit = [...el.querySelectorAll('h2')].find((n) => slug(n.textContent || '') === slug(heading))
    }
    lit?.classList.add('docs-here')
  }, [html, page.id, overview?.emit])

  // "Try this" buttons — wired only for pages where a safe action is obvious.
  const tryActions = []
  if (page.id === 'install') {
    tryActions.push({ label: 'Run doctor', action: 'doctor' })
    tryActions.push({ label: 'Rebuild', action: 'build' })
  }
  if (page.id === 'verify') tryActions.push({ label: 'Run doctor', action: 'doctor' })
  if (page.id === 'upgrade') tryActions.push({ label: 'Update', action: 'update' })

  return (
    <div className="detail-doc">
      <h1 style={{ marginTop: 0 }}>{page.title}</h1>
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
