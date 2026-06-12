import React, { useEffect, useState } from 'react'
import { api } from './api.js'
import { useRoute, go } from './router.js'
import Search from './components/Search.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Section from './pages/Section.jsx'
import Diff from './pages/Diff.jsx'
import Doctor from './pages/Doctor.jsx'
import Themes from './pages/Themes.jsx'
import Graph from './pages/Graph.jsx'
import Settings from './pages/Settings.jsx'
import Toast from './components/Toast.jsx'
import Console from './components/Console.jsx'
import { accentHex, accentContrast } from './accents.js'

// Top-level pages. `match` decides which tab lights up for the current route;
// Library owns both the section browser and single-item views.
const NAV = [
  { hash: '#/', label: 'Dashboard', match: (r) => r.view === 'dashboard' },
  { hash: '#/section/agents', label: 'Library', match: (r) => r.view === 'section' || r.view === 'item' },
  { hash: '#/diff', label: 'Changes', match: (r) => r.view === 'diff' },
  { hash: '#/doctor', label: 'Doctor', match: (r) => r.view === 'doctor' },
  { hash: '#/themes', label: 'Themes', match: (r) => r.view === 'themes' },
  { hash: '#/graph', label: 'Graph', match: (r) => r.view === 'graph' },
  { hash: '#/settings', label: 'Settings', match: (r) => r.view === 'settings' },
]

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

  // The UI wears the deployed theme's accent: overview carries the ACCENT the
  // installed voice declares, and a re-theme build updates it live on refresh.
  useEffect(() => {
    if (!overview?.accent) return
    const root = document.documentElement
    root.style.setProperty('--accent', accentHex(overview.accent))
    root.style.setProperty('--accent-contrast', accentContrast(overview.accent))
  }, [overview])

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

  const runAction = async (name, opts) => {
    try {
      const { job_id } = await api.action(name, opts)
      const label = name === 'build' && opts?.theme
        ? `build (${opts.theme} · ${opts.emit})` : name
      setRuns((rs) => [...rs, { id: job_id, action: label, status: 'running', output: '' }])
      setActiveId(job_id)
      setConsoleOpen(true)
    } catch (e) { setToast({ kind: 'err', msg: e.message }) }
  }

  return (
    <>
      <header className="header">
        <div className="brand" onClick={() => go('#/')} title="Dashboard">
          {/* Sprout mark — inline SVG so it renders identically on every OS
              (the old ⚙ emoji didn't) and follows the accent color. */}
          <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
            <path className="stem" d="M12 21.5v-8" />
            <path className="leaf" d="M12 13.5c0-4.5 3.2-7.5 7.5-7.5 0 4.5-3.2 7.5-7.5 7.5z" />
            <path className="leaf faded" d="M12 13.5c0-4.5-3.2-7.5-7.5-7.5 0 4.5 3.2 7.5 7.5 7.5z" />
          </svg>
          <span className="brand-name">Gene<span className="brand-accent">seed</span></span>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <a key={n.hash} href={n.hash} className={n.match(route) ? 'active' : ''}>
              {n.label}
            </a>
          ))}
        </nav>
        <Search value={query} onChange={setQuery} />
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
          {route.view === 'doctor' && <Doctor />}
          {route.view === 'themes' && <Themes onAction={runAction} />}
          {route.view === 'graph' && <Graph />}
          {route.view === 'settings' && <Settings onAction={runAction} />}
        </main>
      </div>

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </>
  )
}
