import { useCallback, useEffect, useRef, useState } from 'react'

// Module-level result memo, shared by every useAsync caller that names a `key`.
// The console refetched every catalog on every page visit — cross-navigation is
// the whole cost, so the cache key is `key` + the caller's own deps, which
// already carry `dataRev`: a mutation bumps the revision and every cached entry
// under the old revision simply stops being addressed. Session-lifetime, a few
// JSON catalogs — no eviction needed.
const CACHE = new Map()

// Tests re-mock the api between cases; without this the memo would serve one
// case's catalog to the next. Runtime code never calls it.
export function clearAsyncCache() {
  CACHE.clear()
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
export function useAsync(fn, deps = [], key = null) {
  const ck = key === null ? null : `${key}|${deps.join('\u001F')}`
  const [data, setData] = useState(() => (ck !== null && CACHE.has(ck) ? CACHE.get(ck) : null))
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(() => !(ck !== null && CACHE.has(ck)))
  // Keep the latest loader without forcing it into `deps`, so callers can pass
  // an inline arrow without retriggering on every render.
  const fnRef = useRef(fn)
  fnRef.current = fn
  const ckRef = useRef(ck)
  ckRef.current = ck

  const reload = useCallback(() => {
    setLoading(true)
    setError('')
    return Promise.resolve(fnRef.current())
      .then((d) => {
        if (ckRef.current !== null) CACHE.set(ckRef.current, d)
        setData(d)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
    // deps are the caller's refetch triggers; fnRef keeps the loader fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    // A cache hit answers the (re)mount without a fetch; `ck` changes exactly
    // when `reload` does, so keying the effect on reload covers both.
    if (ckRef.current !== null && CACHE.has(ckRef.current)) {
      setData(CACHE.get(ckRef.current))
      setError('')
      setLoading(false)
      return
    }
    reload()
  }, [reload])

  return { data, error, loading, reload, setData }
}
