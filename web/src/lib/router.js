import { useEffect, useState } from 'react'
import { TYPE_TO_SECTION } from './sections.js'

// Every top-level page -> the name the breadcrumb and the sidebar print for it. This is
// the one list of pages: the resolver below lands every hash on one of these keys, App
// renders the page's component, and the sidebar lights the row whose `page` matches.
export const PAGES = {
  overview: 'Overview',
  laws: 'Constitution',
  library: 'Library',
  loops: 'Loops',
  personal: 'Personal',
  installs: 'Installs',
  docs: 'Docs',
  activity: 'Activity',
}

// The pages that carry tabs, and their tab ids in display order. The first id is the
// tab a bare `#/personal` or `#/installs` opens on, and the one an unknown tab falls to.
export const TABS = {
  loops: ['templates', 'bricks'],
  personal: ['rules', 'profile', 'memory', 'notebook'],
  installs: ['hosts', 'edits', 'doctor', 'server'],
}
export const TAB_LABELS = {
  templates: 'Templates',
  bricks: 'Bricks',
  rules: 'Rules',
  profile: 'Profile',
  memory: 'Memory',
  notebook: 'Notebook',
  hosts: 'Hosts',
  edits: 'Local edits',
  doctor: 'Doctor',
  server: 'Server',
}

// Retired route names -> the [page, tab] that absorbed them. The console had fourteen flat
// pages before the five-page layout; every deep link, bookmark and docs cross-reference in
// the wild still spells an old name, so each one resolves here instead of falling through
// to the overview, which is what an unknown hash does (and which would look like the page
// had simply vanished).
//
// RESOLUTION, NOT A REWRITE. The obvious alternative is `location.replace` to canonicalise
// the address bar, but `resolveRoute()` runs inside `useState` (during render), where a
// navigation side effect fires twice under StrictMode and races the `hashchange` listener
// that would re-enter it. The hash the user typed is left alone; only the page it selects
// moves.
export const VIEW_ALIAS = {
  dashboard: ['overview'],
  constitution: ['laws'],
  rules: ['personal', 'rules'],
  profile: ['personal', 'profile'],
  harness: ['installs', 'hosts'],
  harnesses: ['installs', 'hosts'],
  themes: ['installs', 'hosts'],
  diff: ['installs', 'edits'],
  doctor: ['installs', 'doctor'],
  settings: ['installs', 'server'],
  about: ['installs', 'server'],
}

// The lookup tables are plain objects, and a hash is user input: `#/item/constructor/x`
// must not resolve through Object.prototype.
const own = (o, k) => k !== undefined && Object.hasOwn(o, k)
const tabOf = (page, t) => (TABS[page].includes(t) ? t : TABS[page][0])

// A hash -> `{ page, section, item, tab }`.
//   page    - a PAGES key; an unknown hash is the overview.
//   section - the Library kind to open (`#/library` leaves it undefined, which Library
//             reads as "the first kind"). Laws are the one section with a page of their own.
//   tab     - the Loops, Personal or Installs tab.
//   item    - the selected entry's name, URI-decoded. Docs and Activity reuse the slot for
//             their own sub-address: the docs page id, the activity session id.
// Routes: #/ , #/<page>, #/<page>/<tab>[/<item>], #/section/<name>, #/item/<type>/<name>,
// #/docs/<page-id...>, #/activity/<sid>. Every one folds onto ONE page key, so App gives
// every page ONE slot in the tree (see the warning in App.jsx).
export function resolveRoute(hash) {
  const parts = (hash || '#/').slice(2).split('/').filter(Boolean) // drop "#/"
  const [head, a, b] = parts
  const dec = (s) => decodeURIComponent(s || '')
  if (head === 'section' || head === 'item') {
    const section = head === 'item' && own(TYPE_TO_SECTION, a) ? TYPE_TO_SECTION[a] : a
    const item = head === 'item' ? dec(b) : undefined
    return { page: section === 'laws' ? 'laws' : 'library', section, item }
  }
  if (head === 'docs') return { page: 'docs', item: dec(parts.slice(1).join('/')) }
  if (head === 'activity' && a) return { page: 'activity', item: dec(a) }
  // Skills and Agents were pages of their own; each is now a kind in the Library.
  if (head === 'skills' || head === 'agents') return { page: 'library', section: head }
  if (own(TABS, head)) {
    const tab = tabOf(head, a)
    return b && tab === a ? { page: head, tab, item: dec(b) } : { page: head, tab }
  }
  if (own(VIEW_ALIAS, head)) {
    const [page, tab] = VIEW_ALIAS[head]
    return tab ? { page, tab } : { page }
  }
  return { page: own(PAGES, head) ? head : 'overview' }
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
