import React, { useEffect, useState } from 'react'
import { api } from './api.js'
import { useRoute, go } from './router.js'
import Search from './components/Search.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Section from './pages/Section.jsx'
import Diff from './pages/Diff.jsx'
import Toast from './components/Toast.jsx'
import LogDrawer from './components/LogDrawer.jsx'

export default function App() {
  const route = useRoute()
  const [overview, setOverview] = useState(null)
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState(null)
  const [job, setJob] = useState(null) // {id, action} being polled

  const loadOverview = () =>
    api.overview().then(setOverview).catch((e) => setToast({ kind: 'err', msg: e.message }))

  useEffect(() => { loadOverview() }, [])

  // Poll a running job to completion, then toast + refresh.
  useEffect(() => {
    if (!job) return
    const t = setInterval(async () => {
      try {
        const j = await api.job(job.id)
        if (j.status !== 'running') {
          clearInterval(t)
          setJob(null)
          setToast({
            kind: j.status === 'done' ? 'ok' : 'err',
            msg: `${job.action}: ${j.status}`,
            log: j.output,
          })
          loadOverview()
        }
      } catch (e) { clearInterval(t) }
    }, 800)
    return () => clearInterval(t)
  }, [job?.id])

  const runAction = async (name) => {
    try {
      const { job_id } = await api.action(name)
      setToast({ kind: 'ok', msg: `${name} started…` })
      setJob({ id: job_id, action: name })
    } catch (e) { setToast({ kind: 'err', msg: e.message }) }
  }

  return (
    <>
      <header className="header">
        <div className="brand" onClick={() => go('#/')} style={{ cursor: 'pointer' }}>
          ⚙ Genes<span className="dot">eed</span>
        </div>
        <Search value={query} onChange={setQuery} />
        <button className="btn ghost" onClick={() => runAction('doctor')}>Doctor</button>
        <button className="btn ghost" onClick={() => go('#/diff')}>Diff</button>
        <button className="btn ghost" onClick={() => runAction('build')}>Build</button>
        <button className="btn" onClick={() => runAction('update')}>Update</button>
      </header>

      {route.view === 'dashboard' && <Dashboard overview={overview} onAction={runAction} />}
      {route.view === 'section' && <Section section={route.section} query={query} />}
      {route.view === 'item' &&
        <Section section={route.type + 's'} selected={route.name} query={query} />}
      {route.view === 'diff' && <Diff />}

      {toast && <Toast toast={toast} onClose={() => setToast(null)}
                       onShowLog={() => setToast({ ...toast, showDrawer: true })} />}
      {toast?.showDrawer && <LogDrawer title={toast.msg} log={toast.log}
                                       onClose={() => setToast({ ...toast, showDrawer: false })} />}
    </>
  )
}
