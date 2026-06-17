import { useEffect, useState } from 'react'

const HARNESS_KEY = 'geneseed-harness'
export const HARNESSES = [
  { id: 'opencode', label: 'OpenCode' },
  { id: 'claude', label: 'Claude Code' },
]

// Which host the Docs are filtered for. Persisted to localStorage, defaulting
// to OpenCode (the common install, and the server's own default). The server
// hides the other host's pages and strips its inline blocks; this hook is just
// the selector state. Same shape as useColorMode so the chrome stays free of
// storage plumbing.
export function useHarness() {
  const [harness, set] = useState(() => {
    try {
      const v = localStorage.getItem(HARNESS_KEY)
      return v === 'claude' || v === 'opencode' ? v : 'opencode'
    } catch {
      return 'opencode'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(HARNESS_KEY, harness)
    } catch {}
  }, [harness])
  return [harness, set]
}
