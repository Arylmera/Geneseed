import { useState } from 'react'
import { useConfirm } from './useConfirm.jsx'

// The kits payload's rows, shared by Installs / Kits and the Kits page: toggling a kit only
// STAGES a set per install; apply() confirms, then rebuilds that install with exactly that
// set (replace, not replay) through the 'install' job, so the result streams in the console
// and the next fetch (dataRev) shows the row as it now is, kept-edited files included.
// `data` is the /api/kits payload (null while loading).
export const kitsOf = (row) => row.kits || []
export const kitsLocked = (row) => !row.editable || row.state === 'unreadable'

export function useKitStaging(data, onAction) {
  const confirm = useConfirm()
  const [pending, setPending] = useState(() => new Map()) // install id -> Set of kit names
  // A refetch (a finished rebuild bumps dataRev) is the new truth: staged edits against the old one go.
  const [seen, setSeen] = useState(data)
  if (seen !== data) {
    setSeen(data)
    setPending(new Map())
  }
  const setOf = (row) => pending.get(row.id) ?? new Set(kitsOf(row))
  const toggle = (row, name) => {
    const next = new Set(setOf(row))
    if (!next.delete(name)) next.add(name)
    setPending(new Map(pending).set(row.id, next))
  }
  // What applying would change against the install as it is.
  const change = (row) => {
    const set = setOf(row)
    const was = new Set(kitsOf(row))
    return { on: [...set].filter((k) => !was.has(k)), off: [...was].filter((k) => !set.has(k)) }
  }
  const apply = async (row) => {
    const kits = [...setOf(row)]
    const msg =
      `Rebuild ${row.host} · ${row.scope} with kits: ${kits.join(', ') || 'none'}? ` +
      'Members of kits turned off are removed; files you edited are kept.'
    if (await confirm(msg, { confirmLabel: 'Rebuild' })) {
      onAction('install', { host: row.host, path: row.path, kits })
    }
  }
  return { setOf, toggle, change, apply }
}
