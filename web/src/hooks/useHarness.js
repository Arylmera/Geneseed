import { useLocalStorage } from './useLocalStorage.js'
import { HOSTS } from '../lib/hosts.js'

const HARNESS_KEY = 'geneseed-harness'
// The Docs carry two families — OpenCode's, and Claude Code's, which Bob and
// OpenClaude share since both emit through the Claude engine. The selector offers
// the hosts that head a family (lib/hosts.js's `docs` column).
export const HARNESSES = HOSTS.filter((h) => h.docs === h.id).map(({ id, label }) => ({
  id,
  label,
}))

// Which host the Docs are filtered for. Persisted to localStorage. With nothing stored
// it follows the deployed install (`fallback`, from `docsHostOf(overview.emit)`), else
// OpenCode, the server's own default. The server hides the other host's pages and strips
// its inline blocks; this hook is just the selector state.
export function useHarness(fallback = 'opencode') {
  return useLocalStorage(HARNESS_KEY, (v) => (HARNESSES.some((h) => h.id === v) ? v : fallback))
}

// The Docs family an emit target reads. Emit names start with their host id
// (`claude-global`, `openclaude`, …); `files` and unknown emits read the OpenCode pages,
// the server's default.
export function docsHostOf(emit) {
  const e = String(emit || '')
  return HOSTS.find((h) => e.startsWith(h.id))?.docs || 'opencode'
}
