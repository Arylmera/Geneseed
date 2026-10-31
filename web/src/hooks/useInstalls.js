import { api } from '../api/index.js'
import { activeInstalls } from '../lib/hosts.js'
import { useAsync } from './useAsync.js'
import { useLocalStorage } from './useLocalStorage.js'

// The active installs, default first (lib/hosts.js activeInstalls). App's key and deps for
// /api/installs, so every page shares App's one fetch. Empty while loading or unreadable (an api
// without `installs`, as a page's test stubs it, included).
export function useInstalls(dataRev) {
  const { data } = useAsync(
    () =>
      Promise.resolve()
        .then(() => api.installs())
        .catch(() => null),
    [dataRev],
    'installs',
  )
  return activeInstalls(data?.installs)
}

// One page's own install pick (Doctor, Changes, Server): the row id it stored, resolved against
// the active installs at render, else the default. Only a pick is stored, never the fallback, so
// a page nobody picked on keeps following the default. Null with no active install.
export function useInstallPick(page, active) {
  const [id, setId] = useLocalStorage(`geneseed-install-${page}`, (v) => v || null)
  const install = active.find((i) => i.id === id) || active[0] || null
  return [install, (inst) => setId(inst.id)]
}
