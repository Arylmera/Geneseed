import { createContext, useContext, useMemo } from 'react'
import { LEVELS, rankOf, visible } from '../lib/tiers.js'
import { useLocalStorage } from './useLocalStorage.js'

// One level for the whole console: every surface asks here, so the Settings picker and the
// nav can never disagree. Held in a context rather than per-hook state because
// useLocalStorage state is private to each caller, so a second consumer would go stale.
// Unset, unreadable or unknown storage reads as Essentials, the quietest view.
const read = (stored) => (LEVELS.some((l) => l.id === stored) ? stored : 'essentials')

// Outside a provider the level is Power: component tests render surfaces bare, and a bare
// surface must show everything it always did.
const ViewLevelContext = createContext({
  level: 'power',
  setLevel: () => {},
  canSee: (key) => visible(key, 'power'),
  rank: 3,
})

export function ViewLevelProvider({ children }) {
  const [level, setLevel] = useLocalStorage('geneseed-view-level', read)
  const value = useMemo(
    () => ({ level, setLevel, canSee: (key) => visible(key, level), rank: rankOf(level) }),
    [level, setLevel],
  )
  return <ViewLevelContext.Provider value={value}>{children}</ViewLevelContext.Provider>
}

export const useViewLevel = () => useContext(ViewLevelContext)
