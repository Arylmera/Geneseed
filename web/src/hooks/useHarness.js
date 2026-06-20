import { useLocalStorage } from './useLocalStorage.js'

const HARNESS_KEY = 'geneseed-harness'
export const HARNESSES = [
  { id: 'opencode', label: 'OpenCode' },
  { id: 'claude', label: 'Claude Code' },
]

// Which host the Docs are filtered for. Persisted to localStorage, defaulting to
// OpenCode (the common install, and the server's own default). The server hides the
// other host's pages and strips its inline blocks; this hook is just the selector state.
export function useHarness() {
  return useLocalStorage(HARNESS_KEY, (v) => (v === 'claude' || v === 'opencode' ? v : 'opencode'))
}
