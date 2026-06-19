import { useEffect, useState } from 'react'

// State persisted to localStorage. `read` maps the stored string (or null when the key
// is absent) to the initial value — do validation + fallback there. Storage access is
// wrapped so a disabled or throwing localStorage degrades to in-memory state. This is
// the shared base for useColorMode / useFlavour / useHarness, so the try/catch + effect
// pattern lives in exactly one place. Returns [value, setValue].
export function useLocalStorage(key, read) {
  const [value, setValue] = useState(() => {
    try {
      return read(localStorage.getItem(key))
    } catch {
      return read(null)
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* localStorage unavailable — keep state in memory only */
    }
  }, [key, value])
  return [value, setValue]
}
