import { useEffect } from 'react'
import { sortedKey, useStaging } from './useStaging.jsx'

// The Library's install chips: switching a skill off or on for one install only STAGES that
// install's excluded set; apply(key) rebuilds the install with exactly that set (replace, not
// replay) through the 'install' job, as the Kits page does with its kit sets.
//
// The deployed set is read off the catalog rows (`ships[key] === 'excluded'`), the only state a
// chip can turn back on: a skill that is `kit-off` or `absent` there was never excluded, and
// re-admitting it would bring nothing back. `items` is the skills catalog (null while loading);
// `keys` the fleet's install keys, in list order.
//
// Changes stack across skills (one entry per install, not per skill), so one Apply rebuilds an
// install once however many skills changed. One Apply per install: the server runs one job at a
// time, so every Apply waits while any job runs (`busy`).
export const excludedOf = (items, key) =>
  (items || []).filter((it) => it.ships?.[key] === 'excluded').map((it) => it.name)

export function useSkillStaging(items, keys, onAction) {
  const store = useStaging()
  const base = (key) => sortedKey(excludedOf(items, key))
  // The staged entry, only while it was staged against the set the install has now.
  const live = (key) => {
    const e = store.get('skills', key)
    return e && e.base === base(key) ? e : null
  }
  const { prune } = store
  useEffect(() => {
    if (!items) return
    const now = new Map(keys.map((k) => [k, sortedKey(excludedOf(items, k))]))
    prune('skills', (k, e) => now.has(k) && now.get(k) !== e.base)
  }, [items, keys, prune])
  const setOf = (key) => live(key)?.value ?? new Set(excludedOf(items, key))
  // What a chip shows: the deployed state, or the staged move away from it.
  const stateOf = (it, key) => {
    const was = it.ships?.[key]
    const off = setOf(key).has(it.name)
    if (was === 'on' && off) return 'turning-off'
    if (was === 'excluded' && !off) return 'turning-on'
    return was || 'absent'
  }
  const toggle = (key, name) => {
    const next = new Set(setOf(key))
    if (!next.delete(name)) next.add(name)
    store.put('skills', key, next, base(key))
  }
  // Against the install as it is: the names going off and coming back.
  const change = (key) => {
    const set = setOf(key)
    const was = new Set(excludedOf(items, key))
    return {
      off: [...set].filter((n) => !was.has(n)).sort(),
      on: [...was].filter((n) => !set.has(n)).sort(),
    }
  }
  const staged = keys.filter((k) => {
    const c = change(k)
    return c.on.length + c.off.length > 0
  })
  // Applied but not yet refetched counts as running: Apply would send the same rebuild twice.
  const running = (key) => store.running('skills', key) || !!live(key)?.applied
  const failed = (key) => !!live(key)?.failed
  const discard = (key) => {
    if (!running(key)) store.drop('skills', key)
  }
  const apply = async (key, install) => {
    // runAction resolves to the job id, or undefined when the server refused it.
    const job = await onAction('install', {
      host: install.host,
      path: install.path,
      excludeSkills: [...setOf(key)].sort(),
    })
    if (job) store.startApply('skills', key)
    else store.fail('skills', key)
  }
  return { stateOf, toggle, change, staged, apply, running, failed, discard, busy: store.busy }
}
