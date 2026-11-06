import { useState } from 'react'
import { api } from '../api/index.js'
import { activeInstalls, pairOf } from '../lib/hosts.js'
import { useAsync } from './useAsync.js'
import { useLocalStorage } from './useLocalStorage.js'

// The active installs, default first (lib/hosts.js activeInstalls). App's key and deps for
// /api/installs, so every page shares App's one fetch. Null only on the FIRST load, so a page can
// wait rather than read the default and then the pick; a refetch keeps the last list (useAsync
// holds its data), so a page never unmounts what it shows on a `dataRev` bump. Empty when
// unreadable — an api without `installs` (a page's test stub) fails too — and a page then reads
// the default. A failure caches null, as App's own loader does: both share the `installs` key,
// and a different fallback landing last would hide App's "install list unreadable" notice.
function useInstallsRead(dataRev) {
  return useAsync(
    () =>
      Promise.resolve()
        .then(() => api.installs())
        .catch(() => null),
    [dataRev],
    'installs',
  )
}

export function useInstalls(dataRev) {
  const { data, loading } = useInstallsRead(dataRev)
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

// One spot's own install pick (Doctor, Local edits, the Constitution, Loops, the Voice popover):
// the row id it stored, resolved against the active installs at render, else the default. Only a
// pick is stored, never the fallback, so a page nobody picked on keeps following the default. Null
// with no active install (or none read).
export function useInstallPick(page, active) {
  const [id, setId] = useLocalStorage(pickKey(page), (v) => v || null)
  const install = (active || []).find((i) => i.id === id) || active?.[0] || null
  return [install, (inst) => setId(inst.id)]
}

// One user file of every active install, read by `read(pair)`: Rules and Profile. A file is listed
// once: the installs on the shared tier all answer with one path, and the first of them stands for
// the rest. One install's unreadable file blanks nothing else: it lands in `failed`, and `reason`
// holds the first failure, for a page that shows an error only when every read failed. With no
// active install read, `[null]`: the one read names none, so the server answers the default.
// `rev` is the page's dataRev; `reload` re-reads after the page's own write. `sets` null until read.
// A failed refetch keeps the last good list: its cached null is App's notice, and read here as no
// install it would re-key every card and unmount an open draft. A failed FIRST read has no list to
// keep, so it still falls to the default.
export function useInstallFiles(read, rev) {
  const { data: fresh, loading } = useInstallsRead(rev)
  const [held, hold] = useState(null)
  if (fresh && fresh !== held) hold(fresh)
  const list = fresh ?? held
  const active = loading && !list ? null : activeInstalls(list?.installs)
  const targets = active === null ? null : active.length ? active : [null]
  const ids = targets ? targets.map((i) => i?.id ?? '').join('|') : null
  const { data, reload } = useAsync(
    () =>
      targets
        ? Promise.allSettled(targets.map((i) => read(pairOf(i)))).then((rs) => {
            const all = rs.flatMap((r, i) =>
              r.status === 'fulfilled' ? [{ inst: targets[i], data: r.value }] : [],
            )
            const paths = all.map((s) => s.data.path)
            return {
              sets: all.filter((s, i) => paths.indexOf(s.data.path) === i),
              failed: targets.filter((_, i) => rs[i].status === 'rejected'),
              reason: rs.find((r) => r.status === 'rejected')?.reason ?? null,
            }
          })
        : Promise.resolve(null),
    [rev, ids],
  )
  return {
    targets,
    sets: data?.sets ?? null,
    failed: data?.failed ?? [],
    reason: data?.reason,
    reload,
  }
}
