import React, { useEffect, useMemo, useRef } from 'react'
import { go } from '../../lib/router.js'
import PageHeader from '../../components/PageHeader.jsx'
import { renderDoc, slug } from './headings.js'

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

// Reading time at 200 words a minute, rounded up, never under one.
export const minutesOf = (body) =>
  Math.max(1, Math.ceil((body || '').split(/\s+/).filter(Boolean).length / 200))

// Each code block in a figure with a caption bar: the fence's language, if it names one, and
// a Copy button (the click handler below does the copying). A block already wrapped is left
// alone, so a second run of the effect changes nothing.
function captionCode(el) {
  el.querySelectorAll('pre').forEach((pre) => {
    if (pre.parentElement?.classList.contains('docs-code')) return
    const fig = document.createElement('figure')
    fig.className = 'docs-code'
    const cap = document.createElement('figcaption')
    const lang = pre.querySelector('code')?.className.match(/(?:^|\s)language-(\S+)/)?.[1]
    if (lang) {
      const name = document.createElement('span')
      name.className = 'mono'
      name.textContent = lang
      cap.append(name)
    }
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'btn ghost sm'
    btn.setAttribute('aria-label', 'Copy command')
    btn.textContent = 'Copy'
    cap.append(btn)
    pre.replaceWith(fig)
    fig.append(cap, pre)
  })
}

// The block's text without its trailing newline, so a pasted command does not run on paste.
// No clipboard, or a refusal, changes nothing.
function copyCode(fig) {
  const text = (fig.querySelector('pre')?.textContent || '').replace(/\n+$/, '')
  navigator.clipboard?.writeText?.(text)?.catch?.(() => {})
}

export default function MarkdownPage({ page, overview, onAction, section, description }) {
  const ref = useRef(null)
  // Heading ids, and the outline the margin prints, come from renderDoc (headings.js).
  const html = useMemo(
    () => renderDoc({ body: page.body, links: page.links }).html,
    [page.body, page.links],
  )

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.querySelectorAll('blockquote').forEach((q) => {
      const lead = (q.querySelector('strong')?.textContent || '').toLowerCase()
      if (lead.startsWith(ANALOGY_LEAD)) q.classList.add('analogy')
    })
    captionCode(el)
  }, [html])

  // Internal-link / try-this handling. The Markdown component already converts
  // [[..]] to hash links; we just need to intercept clicks so we don't trigger
  // a full page navigation for #/ routes (the SPA already handles them via
  // hashchange).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onClick = (e) => {
      const copy = e.target.closest('.docs-code figcaption button')
      if (copy) return copyCode(copy.closest('.docs-code'))
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
      <PageHeader
        eyebrow={section && `${section} · ${minutesOf(page.body)} min read`}
        title={page.title}
        sub={description}
        actions={
          tryActions.length > 0 &&
          tryActions.map((t) =>
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
          )
        }
      />
      {page.source && (
        <div className="doc-meta">
          <span className="badge">
            <span className="dot" />
            {page.source}
          </span>
        </div>
      )}
      <div className="markdown" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
      {page.link && (
        <div className="doc-link">
          <a className="btn soft sm" href={page.link.hash}>
            {page.link.label}
          </a>
        </div>
      )}
    </div>
  )
}
