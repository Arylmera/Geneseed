import { useEffect, useState } from 'react'
import { api } from '../api/index.js'
import { waitForServerThenReload } from './waitForServer.js'

// How often the running job is polled for fresh output while the console streams.
const JOB_POLL_INTERVAL_MS = 600

// Owns the console's run history and the running-job poller. On mount it
// hydrates from the server's job history (so runs survive reload/restart) and
// resumes polling any still-running job. `runAction` kicks off a named action
// and opens the console; when a job finishes, `onFinish` fires (e.g. to reload
// the overview). Errors surface through `onError` (a toast).
export function useJobs({ onFinish, onError } = {}) {
  const [runs, setRuns] = useState([]) // [{ id, action, status, output, duration }]
  const [activeId, setActiveId] = useState(null) // job id being polled
  const [consoleOpen, setConsoleOpen] = useState(false)

  // Hydrate from server history; resume polling a job left running elsewhere.
  useEffect(() => {
    api
      .jobs()
      .then(({ jobs }) => {
        if (!jobs.length) return
        setRuns(
          jobs.map((j) => ({
            id: j.id,
            action: j.action,
            status: j.status,
            output: j.output || '',
            duration: j.duration,
            started: j.started,
          })),
        )
        const running = jobs.find((j) => j.status === 'running')
        if (running) {
          setActiveId(running.id)
          setConsoleOpen(true)
        }
      })
      .catch(() => {})
  }, [])

  // Poll the active job, streaming output into its run, then refresh on finish.
  useEffect(() => {
    if (!activeId) return
    // Update jobs end with the server restarting itself to load the pulled
    // code, so the poller can lose it mid-bounce — reconnect instead of dying.
    const isUpdate = runs.find((r) => r.id === activeId)?.action === 'update'
    const t = setInterval(async () => {
      try {
        const j = await api.job(activeId)
        setRuns((rs) => {
          const idx = rs.findIndex((r) => r.id === activeId)
          if (idx === -1) return rs
          const r = rs[idx]
          const output = j.output || ''
          // Bail out with the SAME array reference when nothing actually changed, so React
          // skips re-rendering Rail/Topbar/Console/the mounted page on quiet poll ticks.
          // Comparing inside the updater (not against the closed-over `runs`) keeps this
          // race-safe against overlapping ticks.
          if (r.output === output && r.status === j.status && r.duration === j.duration) return rs
          const next = rs.slice()
          next[idx] = { ...r, output, status: j.status, duration: j.duration }
          return next
        })
        if (j.status !== 'running') {
          clearInterval(t)
          setActiveId(null)
          if (isUpdate) {
            // The restart is already queued server-side; give it a beat to go
            // down, then reload once it answers again.
            waitForServerThenReload(2000)
            return
          }
          // Every action re-emits the harness (never the served web assets), so a soft
          // refresh is enough — onFinish refetches the overview + the install/MCP panels.
          // No full page reload, so nothing flashes.
          onFinish?.()
        }
      } catch {
        clearInterval(t)
        // Server went away under the poller (the post-update bounce): wait for
        // it to come back and reload — the job's final state is in its history.
        if (isUpdate) waitForServerThenReload(0)
      }
    }, JOB_POLL_INTERVAL_MS)
    return () => clearInterval(t)
    // the poller keys off activeId; onFinish is a stable callback we omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  const runAction = async (name, opts) => {
    try {
      const { job_id } = await api.action(name, opts)
      const label = name === 'build' && opts?.theme ? `build (${opts.theme} · ${opts.emit})` : name
      setRuns((rs) => [
        ...rs,
        { id: job_id, action: label, status: 'running', output: '', started: Date.now() / 1000 },
      ])
      setActiveId(job_id)
      setConsoleOpen(true)
      return job_id // truthy on success so callers can close a form only when accepted
    } catch (e) {
      onError?.(e)
    }
  }

  const cancelJob = (id) => api.cancelJob(id).catch((e) => onError?.(e))

  return {
    runs,
    activeId,
    consoleOpen,
    setConsoleOpen,
    runAction,
    cancelJob,
    clearRuns: () => setRuns([]),
  }
}
