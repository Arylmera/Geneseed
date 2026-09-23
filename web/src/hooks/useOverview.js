import { useEffect, useState } from 'react'
import { api } from '../api/index.js'

// Loads the overview (the live readout the whole UI hangs off) and the theme
// list (for the voice popover). Exposes `reload` so actions can refresh the
// overview when a job finishes. Errors bubble through `onError` (a toast) AND stay
// readable as `error`: the boot splash waits on the overview, so a first load that
// fails has to be able to lift it — a toast alone renders underneath the splash.
export function useOverview(onError) {
  const [overview, setOverview] = useState(null)
  const [error, setError] = useState(null)
  const [themes, setThemes] = useState([])

  const reload = () =>
    api
      .overview()
      .then((o) => {
        setOverview(o)
        setError(null)
      })
      .catch((e) => {
        setError(e?.body?.message || e?.message || String(e))
        onError?.(e)
      })

  // load once on mount; reload is exposed for callers, not a dependency here
  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    api
      .themes()
      .then((t) => setThemes(t.themes))
      .catch(() => {})
  }, [])

  return { overview, error, themes, reload }
}
