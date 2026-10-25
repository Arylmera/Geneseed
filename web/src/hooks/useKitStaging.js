import { useEffect } from 'react'
import { useConfirm } from './useConfirm.jsx'
import { sortedKey, useStaging } from './useStaging.jsx'

// The kits payload's rows, shared by Installs / Kits and the Kits page: toggling a kit only
// STAGES a set per install; apply() confirms, then rebuilds that install with exactly that
// set (replace, not replay) through the 'install' job, so the result streams in the console
// and the next fetch (dataRev) shows the row as it now is, kept-edited files included.
// `data` is the /api/kits payload (null while loading).
//
// The staged sets live in the App-level store (hooks/useStaging.jsx), keyed by `row.id`
// (host:scope:root): they survive a page change, and a refetch drops one only when that
// install's own kits changed under it — a refetch alone is no new truth, since every job's
// finish bumps dataRev.
export const kitsOf = (row) => row.kits || []
export const kitsLocked = (row) => !row.editable || row.state === 'unreadable'

// `data` only feeds the prune below: each row carries its own kits.
export function useKitStaging(data, onAction) {
  const confirm = useConfirm()
  const store = useStaging()
  // The staged entry, only while it was staged against the kits the row has now.
  const live = (row) => {
    const e = store.get('kits', row.id)
    return e && e.base === sortedKey(kitsOf(row)) ? e : null
  }
  const { prune } = store
  useEffect(() => {
    if (!data?.installs) return
    const now = new Map(data.installs.map((r) => [r.id, sortedKey(kitsOf(r))]))
    prune('kits', (id, e) => now.has(id) && now.get(id) !== e.base)
  }, [data, prune])
  const setOf = (row) => live(row)?.value ?? new Set(kitsOf(row))
  const toggle = (row, name) => {
    const next = new Set(setOf(row))
    if (!next.delete(name)) next.add(name)
    store.put('kits', row.id, next, sortedKey(kitsOf(row)))
  }
  // What applying would change against the install as it is.
  const change = (row) => {
    const set = setOf(row)
    const was = new Set(kitsOf(row))
    return { on: [...set].filter((k) => !was.has(k)), off: [...was].filter((k) => !set.has(k)) }
  }
  // Applied but not yet refetched counts as running: Apply would send the same rebuild twice.
  const running = (row) => store.running('kits', row.id) || !!live(row)?.applied
  const failed = (row) => !!live(row)?.failed
  // Back to the kits the install has. Not while its rebuild runs: the job already has the set.
  const discard = (row) => {
    if (!running(row)) store.drop('kits', row.id)
  }
  const apply = async (row) => {
    const kits = [...setOf(row)]
    const msg =
      `Rebuild ${row.host} · ${row.scope} with kits: ${kits.join(', ') || 'none'}? ` +
      'Members of kits turned off are removed; files you edited are kept.'
    if (!(await confirm(msg, { confirmLabel: 'Rebuild' }))) return
    // runAction resolves to the job id, or undefined when the server refused it.
    const job = await onAction('install', { host: row.host, path: row.path, kits })
    if (job) store.startApply('kits', row.id)
  }
  return { setOf, toggle, change, apply, running, failed, discard }
}
