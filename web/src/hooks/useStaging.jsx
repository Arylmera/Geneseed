import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

// What the switches have STAGED but not applied — kit sets per install, doctrine rules per
// install — held ONCE for the whole console. App mounts the provider around the shell, so a
// staged change survives a page change, a remount and any refetch that does not touch it.
//
// ⚠ RECONCILE ON READ, NEVER RESET ON CHANGE. Each entry keeps the `base` it was staged
// against (the install's own value, as a sorted key). A reader honours the entry only while
// the install still has that base; otherwise it reads the install as it is. Nothing is reset
// on a mismatch: a loading render (no items yet) would otherwise wipe a selection it merely
// could not see yet. Once the page HAS data, an effect prunes the stale entries: an applied
// one would otherwise come back as live staging the day the install returns to its old base
// (the CLI undoing the change), and any stale one would keep beforeunload asking.
//
// `applying` is the one entry whose rebuild is in flight (the server runs one job at a time).
// The next `finish` event settles it: done marks it applied (KEPT, so the old set does not
// flash back before the refetch lands), anything else marks it failed and keeps the value.
const StagingContext = createContext(null)

export const sortedKey = (v) => [...v].sort().join(',')
const dirtyIn = (m) => [...m.values()].some((e) => !e.applied && sortedKey(e.value) !== e.base)

function useStore(activeId, finish) {
  const [maps, setMaps] = useState(() => ({ kits: new Map(), rules: new Map() }))
  const [applying, setApplying] = useState(null) // { kind, key } | null
  // Settled during render on the EVENT's identity (React's "adjust state on prop change").
  const [seen, setSeen] = useState(finish)
  if (seen !== finish) {
    setSeen(finish)
    if (applying && finish) {
      const flag = finish.status === 'done' ? { applied: true } : { failed: true }
      setMaps((ms) => {
        const e = ms[applying.kind].get(applying.key)
        if (!e) return ms
        return {
          ...ms,
          [applying.kind]: new Map(ms[applying.kind]).set(applying.key, { ...e, ...flag }),
        }
      })
      setApplying(null)
    }
  }

  const anyDirty = dirtyIn(maps.kits) || dirtyIn(maps.rules)
  useEffect(() => {
    if (!anyDirty) return undefined
    const onLeave = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [anyDirty])

  const get = (kind, key) => maps[kind].get(key)
  // A value back at its base is no staging at all: the entry goes, so beforeunload stays honest.
  const put = (kind, key, value, base) =>
    setMaps((ms) => {
      const m = new Map(ms[kind])
      if (sortedKey(value) === base) m.delete(key)
      else m.set(key, { value, base })
      return { ...ms, [kind]: m }
    })
  const drop = (kind, key) =>
    setMaps((ms) => {
      const m = new Map(ms[kind])
      m.delete(key)
      return { ...ms, [kind]: m }
    })
  // Drops the entries a reader has seen go stale (their install moved off `base`). Stable, so a
  // page's effect can depend on its data alone; returns the SAME maps when nothing goes.
  const prune = useCallback(
    (kind, isStale) =>
      setMaps((ms) => {
        const gone = [...ms[kind]].filter(([k, e]) => isStale(k, e)).map(([k]) => k)
        if (!gone.length) return ms
        const m = new Map(ms[kind])
        gone.forEach((k) => m.delete(k))
        return { ...ms, [kind]: m }
      }),
    [],
  )
  const startApply = (kind, key) => {
    setApplying({ kind, key })
    setMaps((ms) => {
      const e = ms[kind].get(key)
      if (!e?.failed) return ms
      return { ...ms, [kind]: new Map(ms[kind]).set(key, { value: e.value, base: e.base }) }
    })
  }
  const running = (kind, key) => !!activeId && applying?.kind === kind && applying?.key === key
  return { get, put, drop, prune, startApply, running }
}

export function StagingProvider({ activeId, finish, children }) {
  const store = useStore(activeId, finish)
  return <StagingContext.Provider value={store}>{children}</StagingContext.Provider>
}

// A page mounted without the provider (its own tests) keeps a store of its own, so the hooks
// behave the same; called unconditionally to keep the hook count fixed.
export function useStaging() {
  const local = useStore(null, null)
  return useContext(StagingContext) || local
}
