import { useLocalStorage } from './useLocalStorage.js'

const MODE_KEY = 'geneseed-mode'

// The OS preference, read only when nothing is stored. No matchMedia (jsdom, old engines)
// reads as dark, the console's own default.
function osMode() {
  try {
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

// Light/dark mode persisted to localStorage. A stored choice wins; with none, it follows the
// OS `prefers-color-scheme` (dark when unknown). That OS-derived default is never written:
// useLocalStorage stores only on a toggle, so a later OS change still takes effect until the
// user picks. Returns the current mode and a toggle, so the chrome stays free of storage plumbing.
export function useColorMode() {
  const [mode, setMode] = useLocalStorage(MODE_KEY, (v) =>
    v === 'light' || v === 'dark' ? v : osMode(),
  )
  const toggle = () => setMode((m) => (m === 'light' ? 'dark' : 'light'))
  return [mode, toggle]
}
