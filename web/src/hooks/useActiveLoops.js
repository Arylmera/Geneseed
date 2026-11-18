import { useState } from 'react'
import { api } from '../api/index.js'
import { sameOr, usePoll } from './usePoll.js'

const POLL_MS = 5000

// Loops › Active's read: every loop `geneseed loop init` registered on this machine, polled.
// LOOP.md is the only state, so the page writes exactly one thing — a loop's preset — and leaves
// every decision to the agent's session running the loop (see the spec's out-of-scope list).
// Polled by the page itself, on every section: the rail counts the active loops.
export function useActiveLoops() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  // Its own slot: the next successful poll clears `error`, and a refused write must outlive it.
  const [writeError, setWriteError] = useState(null)
  const [rev, setRev] = useState(0)
  usePoll(
    (alive) =>
      api.activeLoops().then(
        (d) => alive() && (setData(sameOr(d)), setError(null)),
        (e) => alive() && setError(e.message),
      ),
    POLL_MS,
    [rev],
  )
  const onPreset = (root, preset) => {
    setWriteError(null)
    return api.setLoopPreset(root, preset).then(
      () => setRev((r) => r + 1),
      (e) => setWriteError(e.message),
    )
  }
  return { loops: data?.loops ?? null, error: writeError || error, onPreset }
}
