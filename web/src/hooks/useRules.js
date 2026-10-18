import { api } from '../api/index.js'
import { useAsync, dropAsyncKey } from './useAsync.js'

// user-rules.md, as Personal's cards, the Overview's ledger and the Constitution's "Your
// rules" tier read it: ONE cache key, one loader, one deps shape, so the entry a write
// reloads on one page is the entry the others are served (useAsync keys on `key|deps`; a
// site with its own spelling would split it). A failed read is null, never a throw.
// Stale-while-revalidate: agent sessions write the file often (the rule skill), so each
// mount paints the cached copy and refetches once; a write on the page reloads it once.
// The Rules editor keeps its own uncached read — it needs the live fingerprint.
export const useRules = (dataRev) =>
  useAsync(() => api.rules().catch(() => null), [dataRev], 'rules', { revalidate: true })

// For a rules write made where no useRules is mounted.
export const dropRules = () => dropAsyncKey('rules')
