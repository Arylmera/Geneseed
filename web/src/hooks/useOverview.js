import { useEffect, useState } from 'react'
import { api } from '../api/index.js'

// Loads the overview (the live readout the whole UI hangs off) and the theme
// list (for the voice popover). Exposes `reload` so actions can refresh the
// overview when a job finishes. Errors bubble through `onError` (a toast).
export function useOverview(onError) {
  const [overview, setOverview] = useState(null)
  const [themes, setThemes] = useState([])

  const reload = () =>
    api.overview().then(setOverview).catch((e) => onError?.(e))

  useEffect(() => { reload() }, [])
  useEffect(() => { api.themes().then((t) => setThemes(t.themes)).catch(() => {}) }, [])

  return { overview, themes, reload }
}
