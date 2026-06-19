import { useEffect, useState } from 'react'
import { api } from '../api/index.js'

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
          // A build/install re-renders the install (and may rebuild the served web
          // assets), so the page must fully reload to pick them up — same as a restart.
          // Other actions just refetch the overview.
          const finished = runs.find((r) => r.id === activeId)
          if (/^(build|install)/.test(finished?.action || '')) window.location.reload()
          else onFinish?.()
        }
      } catch {
        clearInterval(t)
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
