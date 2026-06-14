import { useCallback, useRef, useState } from 'react'
import { api } from '../api/index.js'
import { SECTIONS, SECTION_ORDER } from '../lib/sections.js'

// Lazy-loaded global search index for the topbar spotlight. Pulls catalog
// items from every Library section, MCP servers from each config target, and
// the Docs/Specs menus into one flat list of {kind, title, desc, hay, route}.
// `prime()` kicks the load on first focus — we don't want to pay this cost at
// app boot for users who never search.
export function useSearchIndex() {
  const [index, setIndex] = useState(null)
  const [error, setError] = useState('')
  const inflight = useRef(null)

  const prime = useCallback(() => {
    if (index || inflight.current) return inflight.current
    const job = (async () => {
      const entries = []

      // Library catalogs — 7 sections in parallel.
      const cats = await Promise.all(
        SECTION_ORDER.map(async (sec) => {
          try {
            const c = await api.catalog(sec)
            return { sec, items: c?.items || [] }
          } catch {
            return { sec, items: [] }
          }
        }),
      )
      for (const { sec, items } of cats) {
        const meta = SECTIONS[sec]
        for (const it of items) {
          const title = it.title || it.name
          entries.push({
            kind: meta.label,
            sortKey: SECTION_ORDER.indexOf(sec),
            title,
            desc: it.desc || '',
            hay: `${title} ${it.desc || ''} ${it.name || ''}`.toLowerCase(),
            route: `#/item/${meta.type}/${encodeURIComponent(it.name)}`,
          })
        }
      }

      // MCP servers — dedupe across targets by name (a server may be wired
      // into both project and global configs; one spotlight row is enough).
      try {
        const mcp = await api.mcp()
        const seen = new Set()
        for (const t of mcp?.targets || []) {
          for (const s of t.servers || []) {
            if (seen.has(s.name)) continue
            seen.add(s.name)
            const title = s.label || s.name
            entries.push({
              kind: 'MCP servers',
              sortKey: 100,
              title,
              desc: s.desc || '',
              hay: `${title} ${s.desc || ''} ${s.name || ''} mcp`.toLowerCase(),
              route: '#/settings',
            })
          }
        }
      } catch {
        // optional — drop silently
      }

      // Docs pages.
      try {
        const docs = await api.docs()
        for (const g of docs?.groups || []) {
          for (const p of g.pages || []) {
            entries.push({
              kind: 'Docs',
              sortKey: 110,
              title: p.title,
              desc: g.label,
              hay: `${p.title || ''} ${p.id || ''} ${g.label || ''}`.toLowerCase(),
              route: `#/docs/${encodeURIComponent(p.id)}`,
            })
          }
        }
      } catch {
        // optional
      }

      // Specs — newest first; route uses filename like the Specs page does.
      try {
        const specs = await api.specs()
        for (const s of specs?.specs || []) {
          entries.push({
            kind: 'Specs',
            sortKey: 120,
            title: s.title || s.filename,
            desc: [s.date, s.purpose].filter(Boolean).join(' · '),
            hay: `${s.title || ''} ${s.filename || ''} ${s.purpose || ''}`.toLowerCase(),
            route: `#/specs/${encodeURIComponent(s.filename)}`,
          })
        }
      } catch {
        // optional
      }

      setIndex(entries)
      inflight.current = null
      return entries
    })().catch((e) => {
      inflight.current = null
      setError(e.message || String(e))
      return []
    })
    inflight.current = job
    return job
  }, [index])

  return { index, error, prime }
}
