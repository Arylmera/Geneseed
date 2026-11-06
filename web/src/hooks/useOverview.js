import { useEffect, useRef, useState } from 'react'
import { api } from '../api/index.js'

// Loads the overview (the live readout the whole UI hangs off) and the theme
// list (for the voice popover). Exposes `reload` so actions can refresh the
// overview when a job finishes. Errors bubble through `onError` (a toast) AND stay
// readable as `error`: the boot splash waits on the overview, so a first load that
// fails has to be able to lift it — a toast alone renders underneath the splash.
//
// A cold daemon answers before its doctor does: `doctor: null` is the warm-up still running on its
// own thread. The overview is asked again until the verdict lands, then `onVerdict` fires once so
// whatever read the pending fleet reads it again. A failed ask leaves `overview` as it was, so it
// counts in `missed` to arm the next one, and says nothing: one toast per poll is noise.
const DOCTOR_POLL_MS = 1500

export function useOverview(onError, onVerdict) {
  const [overview, setOverview] = useState(null)
  const [error, setError] = useState(null)
  const [themes, setThemes] = useState([])

  const [missed, setMissed] = useState(0)

  const ask = () =>
    api.overview().then((o) => {
      setOverview(o)
      setError(null)
    })
  const reload = () =>
    ask().catch((e) => {
      setError(e?.body?.message || e?.message || String(e))
      onError?.(e)
    })

  const waiting = useRef(false)
  useEffect(() => {
    if (overview?.doctor === null) {
      waiting.current = true
      const t = setTimeout(() => ask().catch(() => setMissed((n) => n + 1)), DOCTOR_POLL_MS)
      return () => clearTimeout(t)
    }
    if (waiting.current) {
      waiting.current = false
      onVerdict?.()
    }
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview, missed])

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
