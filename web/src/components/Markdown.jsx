import React from 'react'
import { marked } from 'marked'

// Turn [[name]] into a hash-router link when the server resolved it
// (links: [{label,type,name}]), then render markdown to an HTML string.
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
  return marked.parse(withLinks, { breaks: false })
}

export default function Markdown({ body, links = [] }) {
  return (
    <div className="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(body, links) }} />
  )
}
