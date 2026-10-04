import { useCallback, useState } from 'react'

// State persisted to localStorage. `read` maps the stored string (or null when the key
// is absent) to the initial value — do validation + fallback there. Storage access is
// wrapped so a disabled or throwing localStorage degrades to in-memory state. This is
// the shared base for useColorMode / useFlavour / useHarness / useLayout, so the try/catch
// pattern lives in exactly one place. Returns [value, setValue].
//
// ONLY THE SETTER WRITES. It used to be an effect on `value`, which also stored the initial
// value on first render — so a default computed before the data it depends on had loaded
// (the Docs host, rendered behind the boot splash with no overview yet) was persisted as if
// the user had chosen it, and the real default never got a look in. A value nobody picked
// is now recomputed by `read` on every load instead of frozen into storage.
export function useLocalStorage(key, read) {
  const [value, setValue] = useState(() => {
    try {
      return read(localStorage.getItem(key))
    } catch {
      return read(null)
    }
  })
  const set = useCallback(
    (next) =>
      setValue((prev) => {
        const v = typeof next === 'function' ? next(prev) : next
        try {
          localStorage.setItem(key, v)
        } catch {
          /* localStorage unavailable — keep state in memory only */
        }
        return v
      }),
    [key],
  )
  return [value, set]
}
