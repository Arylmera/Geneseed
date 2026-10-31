import { api } from '../api/index.js'
import { activeInstalls } from '../lib/hosts.js'
import { useAsync } from './useAsync.js'
import { useLocalStorage } from './useLocalStorage.js'

// The active installs, default first (lib/hosts.js activeInstalls). App's key and deps for
// /api/installs, so every page shares App's one fetch. Null only on the FIRST load, so a page can
// wait rather than read the default and then the pick; a refetch keeps the last list (useAsync
// holds its data), so a page never unmounts what it shows on a `dataRev` bump. Empty when
// unreadable — App's own loader caches a failed read as null, and an api without `installs` (a
// page's test stub) fails too — and a page then reads the default.
export function useInstalls(dataRev) {
  const { data, loading } = useAsync(
    () =>
      Promise.resolve()
        .then(() => api.installs())
        .catch(() => ({ installs: [] })),
    [dataRev],
    'installs',
  )
  return loading && !data ? null : activeInstalls(data?.installs)
}

// Where a page keeps its install pick: one key per page, `page` a tab id (`doctor`, `edits`).
export const pickKey = (page) => `geneseed-install-${page}`

// Sets ANOTHER page's pick, for a link that opens that page on one install (the Overview's
// Open, a View diff): store first, then navigate. Storage that throws leaves the page on its
// own pick, which is no worse than before the link.
export function storeInstallPick(page, id) {
  try {
    localStorage.setItem(pickKey(page), id)
  } catch {
    /* storage blocked: the page opens on its own pick */
  }
}

// Reads AND removes a pick another page handed over (the Overview's Open, for the Hosts panel,
// which does not remember a pick of its own): '' when there is none or storage throws.
export function takeInstallPick(page) {
  try {
    const id = localStorage.getItem(pickKey(page)) || ''
    localStorage.removeItem(pickKey(page))
    return id
  } catch {
    return ''
  }
}

// One page's own install pick (Doctor, Changes, Server): the row id it stored, resolved against
// the active installs at render, else the default. Only a pick is stored, never the fallback, so
// a page nobody picked on keeps following the default. Null with no active install (or none read).
export function useInstallPick(page, active) {
  const [id, setId] = useLocalStorage(pickKey(page), (v) => v || null)
  const install = (active || []).find((i) => i.id === id) || active?.[0] || null
  return [install, (inst) => setId(inst.id)]
}
