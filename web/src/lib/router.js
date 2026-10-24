import { useEffect, useRef, useState } from 'react'
import { TYPE_TO_SECTION } from './sections.js'

// Every top-level page -> the name the breadcrumb and the sidebar print for it. This is
// the one list of pages: the resolver below lands every hash on one of these keys, App
// renders the page's component, and the sidebar lights the row whose `page` matches.
export const PAGES = {
  overview: 'Overview',
  laws: 'Constitution',
  library: 'Library',
  kits: 'Kits',
  loops: 'Loops',
  personal: 'Personal',
  installs: 'Installs',
  docs: 'Docs',
  activity: 'Activity',
}

// The pages that carry tabs, and their tab ids in display order. The first id is the
// tab a bare `#/personal` or `#/installs` opens on, and the one an unknown tab falls to.
export const TABS = {
  loops: ['templates', 'bricks', 'active'],
  personal: ['rules', 'profile', 'memory', 'notebook'],
  installs: ['hosts', 'kits', 'edits', 'doctor', 'server'],
}
export const TAB_LABELS = {
  templates: 'Templates',
  bricks: 'Bricks',
  active: 'Active',
  rules: 'Rules',
  profile: 'Profile',
  memory: 'Memory',
  notebook: 'Notebook',
  hosts: 'Hosts',
  kits: 'Kits',
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
// Routes: #/ , #/<page>, #/kits/<kit>, #/<page>/<tab>[/<item>], #/section/<name>, #/item/<type>/<name>,
// #/docs/<page-id...>, #/activity/<sid>. Every one folds onto ONE page key, so App gives
// every page ONE slot in the tree (see the warning in App.jsx).
export function resolveRoute(hash) {
  const parts = (hash || '#/').slice(2).split('/').filter(Boolean) // drop "#/"
  const [head, a, b] = parts
  // A hash is typed input: a malformed escape (`%E0%A4%A`) must not throw during render,
  // so it falls back to the raw text.
  const dec = (s) => {
    try {
      return decodeURIComponent(s || '')
    } catch {
      return s || ''
    }
  }
  if (head === 'section' || head === 'item') {
    const section = head === 'item' && own(TYPE_TO_SECTION, a) ? TYPE_TO_SECTION[a] : a
    const item = head === 'item' ? dec(b) : undefined
    return { page: section === 'laws' ? 'laws' : 'library', section, item }
  }
  if (head === 'docs') return { page: 'docs', item: dec(parts.slice(1).join('/')) }
  if (head === 'kits') return a ? { page: 'kits', item: dec(a) } : { page: 'kits' }
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

// Navigation guards: the seam a page with unsaved work (an editor draft) uses to refuse an
// in-app hash navigation. CONTRACT: a guard is SYNCHRONOUS, is called as `fn({ from, to })`
// with the raw hashes, and returns `false` to refuse; the address bar is then put back and
// the route does not move. An async confirm (the themed useConfirm) refuses first, asks,
// and on "discard" unregisters (or lets its guard pass) and calls `go(to)` itself.
// A guard must not throw: the error escapes the listener with the address bar already moved.
// LIMITS: it sees in-app hash navigation only; a tab close or reload is `beforeunload`'s job.
// A refusal REPLACES the current history entry, it does not undo the move: a refused link
// click leaves a duplicate entry (the next Back seems to do nothing), a refused Back drops
// the entry it left, and `go(to)` after a "discard" pushes a new entry instead of going back.
const guards = new Set()
export function registerNavigationGuard(fn) {
  guards.add(fn)
  return () => guards.delete(fn)
}
export function unregisterNavigationGuard(fn) {
  guards.delete(fn)
}

// The shell's route. A change of PAGE moves focus to `#main` and scrolls it to the top, so a
// keyboard or screen-reader user lands on the new page; an item or tab change inside a page
// does not, or a user walking a list would lose their place. The first mount moves nothing.
export function useRoute() {
  const read = () => resolveRoute(typeof window !== 'undefined' ? window.location.hash : '')
  const [route, setRoute] = useState(read)
  useEffect(() => {
    let prevHash = window.location.hash
    const on = () => {
      const to = window.location.hash
      if (to === prevHash) return // an echo, or our own restore
      for (const guard of guards) {
        if (guard({ from: prevHash, to }) === false) {
          // replaceState fires no hashchange; setting location.hash would re-enter the guard.
          window.history.replaceState(window.history.state, '', prevHash || '#/')
          return
        }
      }
      prevHash = to
      setRoute(read())
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  // The title on every page, first mount included (a deep link needs it too). Focus and
  // scroll only on a later page change, AFTER the commit, so a screen reader reads the new
  // page, never the old one.
  const mounted = useRef(false)
  useEffect(() => {
    document.title = `${PAGES[route.page]} · Geneseed`
    if (!mounted.current) {
      mounted.current = true
      return
    }
    const main = document.getElementById('main')
    main?.focus()
    // Docs' pattern: which element scrolls depends on the layout, so reset both.
    for (const el of [main, document.scrollingElement || document.documentElement]) {
      if (el) el.scrollTop = 0
    }
  }, [route.page])
  return route
}

export const go = (hash) => {
  window.location.hash = hash
}
