import { useEffect, useState } from 'react'
import { SECTION_ALIAS, TYPE_TO_SECTION } from './sections.js'

// Every top-level page -> the `--tab=` flag the topbar's faux prompt shows for it.
// This is the one list of pages: the resolver below lands every hash on one of these
// keys, App renders `PAGES[route.page]`'s component, the rail lights the row whose
// `page` matches, and the topbar prints the flag. Page ownership used to be written
// four times over (App's showX flags, the rail's per-row predicates, the topbar's
// tabFlag and the flat-view set here) and the four drifted: `#/section/agents` lit
// the Agents row while the prompt still said `--tab=library`.
export const PAGES = {
  dashboard: 'overview',
  laws: 'laws',
  rules: 'rules',
  profile: 'profile',
  skills: 'skills',
  agents: 'agents',
  library: 'library',
  docs: 'docs',
  activity: 'activity',
  diff: 'diff',
  doctor: 'doctor',
  harness: 'harness',
  settings: 'settings',
}

// Retired route names -> the page that absorbed them. Two pages merged (Themes
// folded into Harness, About into Settings) and every deep link, bookmark and
// docs cross-reference in the wild still spells the old name — so the old names
// resolve here instead of falling through to the dashboard, which is what an
// unknown hash does (and would have looked like the page had simply vanished).
//
// RESOLUTION, NOT A REWRITE. The obvious alternative is `location.replace` to
// canonicalise the address bar, but `resolveRoute()` runs inside `useState` —
// during render — where a navigation side effect fires twice under StrictMode
// and races the `hashchange` listener that would re-enter it. The hash the user
// typed is left alone; only the page it selects moves.
export const VIEW_ALIAS = {
  themes: 'harness',
  harnesses: 'harness',
  about: 'settings',
}

// Sections that are pages of their own rather than chips on the Library page. Any
// other section (and any item of another type) belongs to Library.
const OWN_PAGE = new Set(['laws', 'skills', 'agents'])
// The lookup tables are plain objects, and a hash is user input: `#/item/constructor/x`
// must not resolve through Object.prototype.
const own = (o, k) => k !== undefined && Object.hasOwn(o, k)

// A hash -> `{ page, section, item }`.
//   page    — a PAGES key; an unknown hash is the dashboard.
//   section — the Library chip to open (`#/agents` pins `agents`; `#/library` leaves it
//             undefined, which Library reads as "the first chip"), SECTION_ALIAS applied.
//   item    — the selected entry's name, URI-decoded. Docs and Activity reuse the slot
//             for their own sub-address: the docs page id, the activity session id.
// Routes: #/ , #/<page>, #/section/<name>, #/item/<type>/<name>, #/docs/<page-id…>,
// #/activity/<sid>. `#/section/…` and `#/item/…` fold into whichever page owns the
// section, so App can give every page ONE slot (see the ⚠ in App.jsx).
export function resolveRoute(hash) {
  const parts = (hash || '#/').slice(2).split('/').filter(Boolean) // drop "#/"
  const [head, a, b] = parts
  let section
  let item
  if (head === 'section') section = a
  else if (head === 'item') {
    section = own(TYPE_TO_SECTION, a) ? TYPE_TO_SECTION[a] : a
    item = decodeURIComponent(b || '')
  } else if (head === 'docs') {
    return { page: 'docs', item: decodeURIComponent(parts.slice(1).join('/')) }
  } else if (head === 'activity' && a) {
    return { page: 'activity', item: decodeURIComponent(a) }
  } else if (head === 'agents') {
    return { page: 'agents', section: 'agents' }
  } else {
    const page = VIEW_ALIAS[head] || head
    return { page: Object.hasOwn(PAGES, page) ? page : 'dashboard' }
  }
  const page = OWN_PAGE.has(section) ? section : 'library'
  return { page, section: own(SECTION_ALIAS, section) ? SECTION_ALIAS[section] : section, item }
}

export function useRoute() {
  const read = () => resolveRoute(typeof window !== 'undefined' ? window.location.hash : '')
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const on = () => setRoute(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export const go = (hash) => {
  window.location.hash = hash
}
