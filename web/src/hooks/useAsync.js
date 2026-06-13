import { useCallback, useEffect, useRef, useState } from 'react'

// Standardises the load-once-with-loading-and-error pattern that every page
// repeated by hand. `fn` is the async loader; `deps` re-run it when they change
// (same contract as useEffect's dependency array). Returns the data, an error
// message, a loading flag, a `reload` (which refetches without flashing the old
// data away), and `setData` for the few callers that post-process the result.
export function useAsync(fn, deps = []) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  // Keep the latest loader without forcing it into `deps`, so callers can pass
  // an inline arrow without retriggering on every render.
  const fnRef = useRef(fn)
  fnRef.current = fn

  const reload = useCallback(() => {
    setLoading(true)
    setError('')
    return Promise.resolve(fnRef.current())
      .then((d) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  // deps are the caller's refetch triggers; fnRef keeps the loader fresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => { reload() }, [reload])

  return { data, error, loading, reload, setData }
}
