import { useEffect, useState } from 'react'

// Routes: #/ (dashboard), #/section/<name>, #/item/<type>/<name>, and one
// flat view per top-level page (#/diff, #/settings, …). The docs view also
// carries a sub-page id: #/docs (default page) or #/docs/<page-id>.
const FLAT_VIEWS = new Set([
  'activity',
  'diff',
  'settings',
  'harness',
  'harnesses',
  'doctor',
  'themes',
  'graph',
  'library',
  'laws',
  'rules',
  'profile',
  'skills',
  'agents',
  'about',
])

// Retired route names -> the page that absorbed them. Two pages merged (Themes
// folded into Harness, About into Settings) and every deep link, bookmark and
// docs cross-reference in the wild still spells the old name — so the old names
// stay in FLAT_VIEWS above and resolve here instead of falling through to the
// dashboard, which is what an unknown hash does (and would have looked like the
// page had simply vanished).
//
// RESOLUTION, NOT A REWRITE. The obvious alternative is `location.replace` to
// canonicalise the address bar, but `parse()` runs inside `useState(parse)` —
// during render — where a navigation side effect fires twice under StrictMode
// and races the `hashchange` listener that would re-enter it. The hash the user
// typed is left alone; only the view it selects moves.
const VIEW_ALIAS = {
  themes: 'harness',
  harnesses: 'harness',
  about: 'settings',
}

export function useRoute() {
  const parse = () => {
    const h = (typeof window !== 'undefined' ? window.location.hash : '') || '#/'
    const parts = h.slice(2).split('/').filter(Boolean) // drop "#/"
    if (parts[0] === 'section') return { view: 'section', section: parts[1] }
    if (parts[0] === 'item')
      return { view: 'item', type: parts[1], name: decodeURIComponent(parts[2] || '') }
    if (parts[0] === 'docs')
      return { view: 'docs', page: decodeURIComponent(parts.slice(1).join('/') || '') }
    if (parts[0] === 'activity' && parts[1])
      return { view: 'activity-detail', sid: decodeURIComponent(parts[1]) }
    if (FLAT_VIEWS.has(parts[0])) return { view: VIEW_ALIAS[parts[0]] || parts[0] }
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
