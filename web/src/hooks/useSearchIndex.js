import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/index.js'
import { SECTIONS, SECTION_ORDER } from '../lib/sections.js'
import { useHarness } from './useHarness.js'

// Lazy-loaded global search index for the topbar spotlight. Pulls catalog
// items from every Library section, MCP servers from each config target, and
// the Docs menu into one flat list of {kind, title, desc, hay, route}.
// `prime()` kicks the load on first focus — we don't want to pay this cost at
// app boot for users who never search. `rev` is the app's data revision: a build,
// a memory delete or an install switch bumps it, and the index is dropped so the
// next search re-reads instead of offering items (and routes) that no longer exist.
export function useSearchIndex(rev = 0) {
  const [index, setIndex] = useState(null)
  const [error, setError] = useState('')
  const inflight = useRef(null)
  const [harness] = useHarness()

  // Drop the index during render when rev/harness move (no stale paint), and the
  // in-flight handle in an effect (refs are not touched during render).
  const resetKey = `${rev}|${harness}`
  const [seenKey, setSeenKey] = useState(resetKey)
  if (seenKey !== resetKey) {
    setSeenKey(resetKey)
    setIndex(null)
  }
  useEffect(() => {
    inflight.current = null
  }, [resetKey])

  const prime = useCallback(() => {
    if (index || inflight.current) return inflight.current
    const job = (async () => {
      const entries = []

      // Content catalogs, in parallel. Laws and Skills live on their own tabs
      // (not in SECTION_ORDER), but the spotlight should still find them — so
      // index them alongside the Library sections.
      const searchSections = ['laws', 'skills', ...SECTION_ORDER]
      const cats = await Promise.all(
        searchSections.map(async (sec) => {
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
            sortKey: searchSections.indexOf(sec),
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
              // MCP wiring lives on the Harness page, not Settings.
              route: '#/harness',
            })
          }
        }
      } catch {
        // optional — drop silently
      }

      // Docs pages.
      try {
        const docs = await api.docs(harness)
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
  }, [index, harness])

  return { index, error, prime }
}
