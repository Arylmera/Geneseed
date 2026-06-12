import React from 'react'
import { marked } from 'marked'

// Render markdown, turning [[name]] into hash-router links when the server
// resolved them (links: [{label,type,name}]).
export default function Markdown({ body, links = [] }) {
  const byLabel = new Map(links.map((l) => [l.label, l]))
  const withLinks = (body || '').replace(/\[\[([^\]]+)\]\]/g, (m, label) => {
    const l = byLabel.get(label.trim())
    if (!l) return m
    return `[${l.label}](#/item/${l.type}/${encodeURIComponent(l.name)})`
  })
  const html = marked.parse(withLinks, { breaks: false })
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
}
