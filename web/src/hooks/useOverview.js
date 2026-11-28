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
//
// The asks back off (1.5 s, x1.5 each, capped at 4 s) and stop once the time waited would pass
// DOCTOR_WAIT_MS: `warmup` is 'pending' while it asks and 'slow' once it has given up, so the page
// can say what is happening and `recheck` can start a fresh round. null: no verdict is awaited.
const DOCTOR_POLL_MS = 1500
const DOCTOR_POLL_MAX_MS = 4000
const DOCTOR_WAIT_MS = 60000
const pollDelay = (tries) => Math.min(DOCTOR_POLL_MS * 1.5 ** tries, DOCTOR_POLL_MAX_MS)

export function useOverview(onError, onVerdict) {
  const [overview, setOverview] = useState(null)
  const [error, setError] = useState(null)
  const [themes, setThemes] = useState([])

  const [missed, setMissed] = useState(0)
  const [slow, setSlow] = useState(false)
  const tries = useRef(0)
  const spent = useRef(0)

  const ask = () =>
    api.overview().then((o) => {
      setOverview(o)
      setError(null)
      if (o?.doctor !== null) {
        // a verdict ends the round: the next one starts from the first delay
        tries.current = 0
        spent.current = 0
        setSlow(false)
      }
      return o
    })
  const reload = () =>
    ask().catch((e) => {
      setError(e?.body?.message || e?.message || String(e))
      onError?.(e)
    })

  const waiting = useRef(false)
  const spentUp = () => spent.current + pollDelay(tries.current) > DOCTOR_WAIT_MS
  useEffect(() => {
    if (overview?.doctor === null) {
      waiting.current = true
      if (spentUp()) return undefined
      const delay = pollDelay(tries.current)
      const t = setTimeout(() => {
        spent.current += delay
        tries.current += 1
        ask().then(
          (o) => {
            if (o?.doctor === null && spentUp()) setSlow(true)
          },
          () => {
            setMissed((n) => n + 1)
            if (spentUp()) setSlow(true)
          },
        )
      }, delay)
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

  const recheck = () => {
    tries.current = 0
    spent.current = 0
    setSlow(false)
    return ask().catch(() => setMissed((n) => n + 1))
  }
  const warmup = overview?.doctor === null ? (slow ? 'slow' : 'pending') : null

  return { overview, error, themes, reload, warmup, recheck }
}
