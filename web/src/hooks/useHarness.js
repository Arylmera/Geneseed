import { useLocalStorage } from './useLocalStorage.js'
import { HOSTS } from '../lib/hosts.js'

const HARNESS_KEY = 'geneseed-harness'
// The Docs selector names each host. A page or block tagged with a host shows to that host;
// one tagged `claude` is the Claude-engine family and shows to Claude Code, Bob and
// OpenClaude alike — the server applies that rule (HOST_FAMILY in js/web/docs.mjs).
export const HARNESSES = HOSTS.map(({ id, label }) => ({ id, label }))

// Which host the Docs are filtered for. Persisted to localStorage, but only once the user
// picks one; a value stored before the selector named four hosts ('opencode' / 'claude') is
// still a host id, so it stays valid. With nothing stored it follows the deployed install
// (`fallback`, from `docsHostOf(overview.emit)`), else OpenCode, the server's own default.
// The fallback is applied at render, never stored: the page first renders behind the boot
// splash with no overview, and a stored fallback would freeze that 'opencode' for good. The
// server hides the other hosts' pages and strips their inline blocks; this hook is just the
// selector state.
export function useHarness(fallback = 'opencode') {
  const [stored, setStored] = useLocalStorage(HARNESS_KEY, (v) =>
    HARNESSES.some((h) => h.id === v) ? v : null,
  )
  return [stored ?? fallback, setStored]
}

// The host an emit target installs into. Emit names start with their host id
// (`claude-global`, `openclaude`, …); `files` and unknown emits read the OpenCode pages,
// the server's default.
export function docsHostOf(emit) {
  const e = String(emit || '')
  return HOSTS.find((h) => e.startsWith(h.id))?.id || 'opencode'
}
