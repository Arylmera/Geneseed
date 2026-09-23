import { useLocalStorage } from './useLocalStorage.js'

const HARNESS_KEY = 'geneseed-harness'
export const HARNESSES = [
  { id: 'opencode', label: 'OpenCode' },
  { id: 'claude', label: 'Claude Code' },
]

// Which host the Docs are filtered for. Persisted to localStorage. With nothing stored
// it follows the deployed install (`fallback`, from `docsHostOf(overview.emit)`), else
// OpenCode, the server's own default. The server hides the other host's pages and strips
// its inline blocks; this hook is just the selector state.
export function useHarness(fallback = 'opencode') {
  return useLocalStorage(HARNESS_KEY, (v) => (v === 'claude' || v === 'opencode' ? v : fallback))
}

// The Docs carry two families: OpenCode's, and Claude Code's — which Bob and Copilot
// share, since both emit through the Claude engine. `files` and unknown emits read the
// OpenCode pages, the server's default.
export function docsHostOf(emit) {
  const e = String(emit || '')
  return /^(claude|bob|copilot)/.test(e) ? 'claude' : 'opencode'
}
