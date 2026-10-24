import React, { useMemo } from 'react'
import { marked } from 'marked'

// Markdown bodies are not all ours: wiki pages, memory and notebook entries are
// written by agents and web clippings, and marked passes raw HTML through. The
// page holds the POST token, so one `<img onerror>` in a clipping could drive
// /api/install. Raw HTML stays allowed (docs use <div align>, <kbd>, <sub>);
// what goes is anything that runs script or leaves the page by a non-web scheme.
// SVG animation (SMIL) can write `javascript:` into an href after the walk, and a
// nested <template> keeps its content in a fragment the walk never enters, so both
// go whole. Names are compared lower-cased: the parser keeps SVG's camelCase
// (`animateMotion`), which a CSS type selector would match case-sensitively.
// Raw-text elements (xmp, noembed, noframes, noscript, plaintext) hide markup as
// text in one parse that the next parse, under MathML/SVG, reads as elements.
const DROP_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'form',
  'template',
  'animate',
  'set',
  'animatemotion',
  'animatetransform',
  'discard',
  'animatecolor',
  'xmp',
  'noembed',
  'noframes',
  'noscript',
  'plaintext',
])
const URL_ATTRS = new Set([
  'href',
  'src',
  'xlink:href',
  'action',
  'formaction',
  'poster',
  'background',
])
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto'])

function safeUrl(value) {
  // Browsers ignore whitespace and control characters inside a scheme, so
  // `java\nscript:` must be read as `javascript:`.
  // eslint-disable-next-line no-control-regex
  const m = /^([a-z][a-z0-9+.-]*):/.exec(value.replace(/[\u0000- ]/g, '').toLowerCase())
  return !m || SAFE_SCHEMES.has(m[1])
}

// Exported for the test that pins it. A <template> parses inert: nothing in it
// loads or runs until it is attached, so the walk happens before any harm can.
// `style` goes too: untrusted CSS can lay a transparent full-viewport link over
// the console, or beacon out through `background:url()`. Remote <img src> is
// left to the page CSP (`img-src`), not filtered twice here.
// The sink parses the output again, and a serialise-then-parse can build elements
// the walk never saw (mutation XSS). So the pass repeats until its output is
// stable; markup that never settles is refused whole.
export function sanitizeHtml(html) {
  for (let i = 0; i < 4; i++) {
    const next = sanitizePass(html)
    if (next === html) return next
    html = next
  }
  return ''
}

function sanitizePass(html) {
  const t = document.createElement('template')
  t.innerHTML = html
  t.content.querySelectorAll('*').forEach((el) => {
    if (DROP_TAGS.has(el.localName.toLowerCase())) return el.remove()
    for (const { name, value } of [...el.attributes]) {
      const n = name.toLowerCase()
      if (
        n.startsWith('on') ||
        n === 'srcdoc' ||
        n === 'style' ||
        (URL_ATTRS.has(n) && !safeUrl(value))
      ) {
        el.removeAttribute(name)
      }
    }
  })
  return t.innerHTML
}

// Turn [[name]] into a hash-router link when the server resolved it
// (links: [{label,type,name}]), then render markdown to a sanitised HTML string.
// Exported (not just used by the component below) because MarkdownPage
// needs the raw string for its own ref'd container and DOM post-processing
// (heading ids, click interception, scroll-to-anchor) — this is the one
// place the wikilink rewrite + marked.parse call lives.
export function renderMarkdown(body, links = []) {
  const byLabel = new Map(links.map((l) => [l.label, l]))
  const withLinks = (body || '').replace(/\[\[([^\]]+)\]\]/g, (m, label) => {
    const l = byLabel.get(label.trim())
    if (!l) return m
    return `[${l.label}](#/item/${l.type}/${encodeURIComponent(l.name)})`
  })
  return sanitizeHtml(marked.parse(withLinks, { breaks: false }))
}

const NO_LINKS = []

export default function Markdown({ body, links = NO_LINKS }) {
  const html = useMemo(() => renderMarkdown(body, links), [body, links])
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
}
