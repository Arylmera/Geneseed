import { useState } from 'react'
import { api } from '../api/index.js'
import { sameOr, usePoll } from './usePoll.js'

const POLL_MS = 5000

// Every run `geneseed factory init` registered, polled (the rail counts them on both tabs).
export function useActiveFactories() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  usePoll(
    (alive) =>
      api.activeFactories().then(
        (d) => alive() && (setData(sameOr(d)), setError(null)),
        (e) => alive() && setError(e.message),
      ),
    POLL_MS,
    [],
  )
  return { runs: data ? data.factories || [] : null, error }
}
