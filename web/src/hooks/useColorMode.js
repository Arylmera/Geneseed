import { useLocalStorage } from './useLocalStorage.js'

const MODE_KEY = 'geneseed-mode'

// Light/dark mode persisted to localStorage, defaulting to dark. Returns the
// current mode and a toggle, so the chrome stays free of storage plumbing.
export function useColorMode() {
  const [mode, setMode] = useLocalStorage(MODE_KEY, (v) => (v === 'light' ? 'light' : 'dark'))
  const toggle = () => setMode((m) => (m === 'light' ? 'dark' : 'light'))
  return [mode, toggle]
}
