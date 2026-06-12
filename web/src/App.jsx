import React, { useEffect, useState } from 'react'
import { api } from './api.js'
import { useRoute, go } from './router.js'
import Search from './components/Search.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Section from './pages/Section.jsx'
import Diff from './pages/Diff.jsx'
import Toast from './components/Toast.jsx'
import Console from './components/Console.jsx'

export default function App() {
  const route = useRoute()
  const [overview, setOverview] = useState(null)
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState(null)
  const [runs, setRuns] = useState([]) // [{id, action, status, output}]
  const [activeId, setActiveId] = useState(null) // job id being polled
  const [consoleOpen, setConsoleOpen] = useState(true)

  const loadOverview = () =>
    api.overview().then(setOverview).catch((e) => setToast({ kind: 'err', msg: e.message }))

  useEffect(() => { loadOverview() }, [])

  // Poll the running job, streaming its output into the console run, then refresh.
  useEffect(() => {
    if (!activeId) return
    const t = setInterval(async () => {
      try {
        const j = await api.job(activeId)
        setRuns((rs) => rs.map((r) =>
          r.id === activeId ? { ...r, output: j.output || '', status: j.status } : r))
        if (j.status !== 'running') {
          clearInterval(t)
          setActiveId(null)
          loadOverview()
        }
      } catch (e) { clearInterval(t) }
    }, 600)
    return () => clearInterval(t)
  }, [activeId])

  const runAction = async (name) => {
    try {
      const { job_id } = await api.action(name)
      setRuns((rs) => [...rs, { id: job_id, action: name, status: 'running', output: '' }])
      setActiveId(job_id)
      setConsoleOpen(true)
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

      <div className={`layout ${consoleOpen ? '' : 'console-collapsed'}`}>
        <Console
          runs={runs}
          collapsed={!consoleOpen}
          onToggle={() => setConsoleOpen((v) => !v)}
          onClear={() => setRuns([])}
        />
        <main className="main">
          {route.view === 'dashboard' && <Dashboard overview={overview} onAction={runAction} />}
          {route.view === 'section' && <Section section={route.section} query={query} />}
          {route.view === 'item' &&
            <Section section={route.type + 's'} selected={route.name} query={query} />}
          {route.view === 'diff' && <Diff />}
        </main>
      </div>

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </>
  )
}
