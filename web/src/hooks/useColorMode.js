import { useEffect, useState } from 'react'

const MODE_KEY = 'geneseed-mode'

// Light/dark mode persisted to localStorage, defaulting to dark. Returns the
// current mode and a toggle, so the chrome stays free of storage plumbing.
export function useColorMode() {
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem(MODE_KEY) || 'dark' } catch { return 'dark' }
  })
  useEffect(() => {
    try { localStorage.setItem(MODE_KEY, mode) } catch {}
  }, [mode])
  const toggle = () => setMode((m) => (m === 'light' ? 'dark' : 'light'))
  return [mode, toggle]
}
