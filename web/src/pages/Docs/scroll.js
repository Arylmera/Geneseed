import { useSyncExternalStore } from 'react'

// The element the reader scrolls: `main#main` in the app shell when it overflows, else the
// document itself (the other layouts).
export function scroller() {
  const main = document.getElementById('main')
  if (main && main.scrollHeight > main.clientHeight) return main
  return document.scrollingElement || document.documentElement
}

// A capture listener on the document: scroll does not bubble, so this is how `main#main`
// scrolling is heard too.
function subscribe(onChange) {
  document.addEventListener('scroll', onChange, { capture: true, passive: true })
  return () => document.removeEventListener('scroll', onChange, { capture: true })
}

// `read()` (a primitive read off the DOM) now and after every scroll anywhere in the page.
// React re-reads it once after mount, so a value that needs the committed DOM is right from
// the first paint.
export const useOnScroll = (read) => useSyncExternalStore(subscribe, read, () => null)
