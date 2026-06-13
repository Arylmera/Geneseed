import { useEffect, useState } from 'react'

// Routes: #/ (dashboard), #/section/<name>, #/item/<type>/<name>, and one
// flat view per top-level page (#/diff, #/settings, …). The docs view also
// carries a sub-page id: #/docs (default page) or #/docs/<page-id>.
const FLAT_VIEWS = new Set(['diff', 'settings', 'doctor', 'themes', 'graph', 'library'])

export function useRoute() {
  const parse = () => {
    const h = (typeof window !== 'undefined' ? window.location.hash : '') || '#/'
    const parts = h.slice(2).split('/').filter(Boolean) // drop "#/"
    if (parts[0] === 'section') return { view: 'section', section: parts[1] }
    if (parts[0] === 'item')
      return { view: 'item', type: parts[1], name: decodeURIComponent(parts[2] || '') }
    if (parts[0] === 'docs')
      return { view: 'docs', page: decodeURIComponent(parts.slice(1).join('/') || '') }
    if (parts[0] === 'specs')
      return { view: 'specs', spec: decodeURIComponent(parts.slice(1).join('/') || '') }
    if (FLAT_VIEWS.has(parts[0])) return { view: parts[0] }
    return { view: 'dashboard' }
  }
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const on = () => setRoute(parse())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export const go = (hash) => {
  window.location.hash = hash
}
