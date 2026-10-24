import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// Module-level result memo, shared by every useAsync caller that names a `key`.
// The console refetched every catalog on every page visit — cross-navigation is
// the whole cost, so the cache key is `key` + the caller's own deps, which
// already carry `dataRev`: a mutation bumps the revision and every cached entry
// under the old revision simply stops being addressed. Session-lifetime, a few
// JSON catalogs — no eviction needed.
const CACHE = new Map()
// Mounted consumers per cache key, so a fetch that lands updates every one of them,
// not only the instance that asked.
const SUBS = new Map()

// Tests re-mock the api between cases; without this the memo would serve one
// case's catalog to the next. Runtime code never calls it.
export function clearAsyncCache() {
  CACHE.clear()
}

// Drop every memoised entry under one `key`, whatever its deps: a write that lands
// before the page that reads it is mounted (Library's memory->rule promote) has no
// mounted `reload()` to call, and the next mount must not be served the old copy.
export function dropAsyncKey(key) {
  for (const ck of CACHE.keys()) if (ck.startsWith(`${key}|`)) CACHE.delete(ck)
}

// Standardises the load-once-with-loading-and-error pattern that every page
// repeated by hand. `fn` is the async loader; `deps` re-run it when they change
// (same contract as useEffect's dependency array). Returns the data, an error
// message, a loading flag, a `reload` (which refetches without flashing the old
// data away), and `setData` for the few callers that post-process the result.
//
// `key` (optional) opts the call site into the cross-navigation cache above: a
// remount with the same key + deps serves the memoised result instead of
// refetching. An explicit `reload()` always hits the network and refreshes the
// cache, so mutation flows keep their force-refetch semantics.
//
// `revalidate` (keyed calls only) makes a cache hit stale-while-revalidate: the
// memoised value paints at once and one fetch per mount replaces it — for a file
// something outside the console writes (user-rules.md, by an agent session).
export function useAsync(fn, deps = [], key = null, { revalidate = false } = {}) {
  const ck = key === null ? null : `${key}|${deps.join('\u001F')}`
  const [data, setData] = useState(() => (ck !== null && CACHE.has(ck) ? CACHE.get(ck) : null))
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(() => !(ck !== null && CACHE.has(ck)))
  // Keep the latest loader without forcing it into `deps`, so callers can pass
  // an inline arrow without retriggering on every render. Written in a layout
  // effect, not during render (react-hooks/refs): a render React discards must
  // not leave its loader behind. Layout effects run before the passive effect
  // below, so the mount/deps fetch still sees this render's values.
  const fnRef = useRef(fn)
  const ckRef = useRef(ck)
  useLayoutEffect(() => {
    fnRef.current = fn
    ckRef.current = ck
  })

  // Bumped by every reload and every cache hit: only the answer to the latest one may
  // touch state, so a slow fetch for deps the caller has left (or an older reload of
  // the same deps) lands on nothing instead of overwriting newer data. A key match
  // alone would not do: unkeyed calls have no key, and a repeat reload shares one.
  const genRef = useRef(0)

  // react-hooks/use-memo wants a literal dependency array; this hook's whole
  // contract is forwarding the caller's `deps`, so that rule cannot hold here.
  const reload = useCallback(() => {
    const gen = ++genRef.current
    const live = () => gen === genRef.current
    setLoading(true)
    setError('')
    // The key this fetch answers — not whatever the deps have moved on to by the time
    // it lands.
    const at = ckRef.current
    // A failure sets `error` and leaves `data` alone: a failed refetch keeps the last
    // good result on screen, a failed first load leaves it null beside the error.
    return Promise.resolve(fnRef.current())
      .then((d) => {
        if (!live()) return
        setData(d)
        if (at === null) return
        CACHE.set(at, d)
        for (const set of SUBS.get(at) || []) set(d)
      })
      .catch((e) => {
        if (live()) setError(e.message)
      })
      .finally(() => {
        if (live()) setLoading(false)
      })
    // deps are the caller's refetch triggers; fnRef keeps the loader fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/use-memo
  }, deps)

  useEffect(() => {
    // A cache hit answers the (re)mount without a fetch (unless `revalidate`); `ck`
    // changes exactly when `reload` does, so keying the effect on reload covers both.
    const at = ckRef.current
    if (at !== null) {
      if (!SUBS.has(at)) SUBS.set(at, new Set())
      SUBS.get(at).add(setData)
    }
    const unsubscribe = () => SUBS.get(at)?.delete(setData)
    if (at !== null && CACHE.has(at)) {
      genRef.current++
      setData(CACHE.get(at))
      setError('')
      setLoading(false)
      if (!revalidate) return unsubscribe
    }
    reload()
    return unsubscribe
    // `revalidate` is a per-call-site constant, not a refetch trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload])

  return { data, error, loading, reload, setData }
}
