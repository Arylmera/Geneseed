import { useEffect, useState } from 'react'
import { api } from '../api/index.js'

// How often the running job is polled for fresh output while the console streams.
const JOB_POLL_INTERVAL_MS = 600

// After an update the server restarts itself to load the new code; wait for it
// to answer /api/ping again (same pattern as ServerControl), then hard-reload so
// the page picks up the new UI bundle and CSRF token.
const RESTART_POLL_INTERVAL_MS = 1000
const RESTART_MAX_TRIES = 30

async function reloadWhenServerBack(initialDelayMs) {
  await new Promise((r) => setTimeout(r, initialDelayMs))
  for (let i = 0; i < RESTART_MAX_TRIES; i++) {
    try {
      await api.ping()
      break
    } catch {
      await new Promise((r) => setTimeout(r, RESTART_POLL_INTERVAL_MS))
    }
  }
  window.location.reload()
}

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
        setRuns((rs) =>
          rs.map((r) =>
            r.id === activeId
              ? { ...r, output: j.output || '', status: j.status, duration: j.duration }
              : r,
          ),
        )
        if (j.status !== 'running') {
          clearInterval(t)
          setActiveId(null)
          if (isUpdate) {
            // The restart is already queued server-side; give it a beat to go
            // down, then reload once it answers again.
            reloadWhenServerBack(2000)
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
        if (isUpdate) reloadWhenServerBack(0)
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
      setRuns((rs) => [...rs, { id: job_id, action: label, status: 'running', output: '' }])
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
