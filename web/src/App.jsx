import React, { useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import { useRoute, go } from './router.js'
import Search from './components/Search.jsx'
import { Icon, Sprout } from './components/Icon.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Section from './pages/Section.jsx'
import Diff from './pages/Diff.jsx'
import Doctor from './pages/Doctor.jsx'
import Themes from './pages/Themes.jsx'
import Graph from './pages/Graph.jsx'
import Settings from './pages/Settings.jsx'
import Toast from './components/Toast.jsx'
import Console from './components/Console.jsx'
import { applyAccent, accentHex } from './accents.js'

// Rail navigation, grouped like the design. `match` decides which item lights
// up; `tag` surfaces a live count from the overview.
const NAV = [
  { group: 'Harness' },
  { hash: '#/', id: 'dashboard', label: 'Dashboard', icon: 'dashboard',
    match: (r) => r.view === 'dashboard' },
  { hash: '#/section/agents', id: 'library', label: 'Library', icon: 'library',
    match: (r) => r.view === 'section' || r.view === 'item' },
  { hash: '#/graph', id: 'graph', label: 'Graph', icon: 'graph', match: (r) => r.view === 'graph' },
  { group: 'Maintain' },
  { hash: '#/diff', id: 'changes', label: 'Changes', icon: 'changes', match: (r) => r.view === 'diff',
    tag: (o) => (o?.diff ? o.diff.edited + o.diff.added : null) || null },
  { hash: '#/doctor', id: 'doctor', label: 'Doctor', icon: 'doctor', match: (r) => r.view === 'doctor',
    tag: (o) => (o?.doctor && !o.doctor.ok ? o.doctor.problems.length : null), warn: true },
  { group: 'Configure' },
  { hash: '#/themes', id: 'themes', label: 'Themes', icon: 'themes', match: (r) => r.view === 'themes' },
  { hash: '#/settings', id: 'settings', label: 'Settings', icon: 'settings',
    match: (r) => r.view === 'settings' },
]

// Route view -> the --tab flag the fake prompt displays.
const TAB_FLAG = { dashboard: 'overview', section: 'library', item: 'library',
  diff: 'diff', doctor: 'doctor', themes: 'themes', graph: 'graph', settings: 'settings' }

const MODE_KEY = 'geneseed-mode'

function Rail({ route, overview, onOpenVoice }) {
  return (
    <aside className="rail">
      <div className="rail-brand" onClick={() => go('#/')} title="Dashboard">
        <Sprout />
        <div className="brand-text">
          <span className="brand-name">Gene<b>seed</b></span>
          <span className="brand-sub">harness console</span>
        </div>
      </div>
      {NAV.map((n, i) => {
        if (n.group) return <div className="rail-group" key={'g' + i}>{n.group}</div>
        const tag = n.tag ? n.tag(overview) : null
        return (
          <div className="rail-nav" key={n.id}>
            <a className={`rail-item ${n.match(route) ? 'active' : ''}`} href={n.hash}
              aria-current={n.match(route) ? 'page' : undefined}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {tag ? <span className="tag" style={n.warn ? { color: 'var(--warn)' } : null}>{tag}</span> : null}
            </a>
          </div>
        )
      })}
      <div className="rail-spacer" />
      <div className="rail-foot">
        <div className="voice" onClick={onOpenVoice} title="Switch deployed voice">
          <span className="voice-orb" />
          <div className="voice-meta">
            <div className="vk">deployed voice</div>
            <div className="vv">{overview?.theme || '—'}</div>
          </div>
          <Icon name="chevron" className="chev glyph" />
        </div>
      </div>
    </aside>
  )
}

function VoicePopover({ themes, current, onPick, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])
  return (
    <div className="pop" ref={ref}>
      <div className="tick" style={{ padding: '4px 10px 8px' }}>Switch voice</div>
      {themes.map((t) => (
        <div key={t.name} className={`pop-item ${t.name === current ? 'on' : ''}`}
          onClick={() => onPick(t.name)}>
          <span className="po" style={{ background: accentHex(t.accent),
            boxShadow: `0 0 8px ${accentHex(t.accent)}` }} />
          <span className="pn">{t.name}</span>
        </div>
      ))}
    </div>
  )
}

// Shorten the deploy target for the fake prompt: home dir -> "~".
function promptPath(target) {
  if (!target) return '~'
  return target.replace(/\\/g, '/').replace(/^\/?(home|Users)\/[^/]+/i, '~').replace(/^[A-Z]:\/Users\/[^/]+/i, '~')
}

function Topbar({ route, target, query, onQuery, mode, onToggleMode }) {
  return (
    <div className="topbar">
      <div className="prompt">
        <span className="path">{promptPath(target)}</span>
        <span className="sep">$</span>
        <span className="cmd">geneseed</span>{' '}
        <span className="flag">--tab={TAB_FLAG[route.view] || route.view}</span>
        <span className="cur" />
      </div>
      <div className="topbar-spacer" />
      <Search value={query} onChange={onQuery} />
      <button className="iconbtn" title={mode === 'light' ? 'Switch to dark' : 'Switch to light'}
        onClick={onToggleMode}>
        <Icon name={mode === 'light' ? 'moon' : 'sun'} />
      </button>
    </div>
  )
}

export default function App() {
  const route = useRoute()
  const [overview, setOverview] = useState(null)
  const [themes, setThemes] = useState([])           // for the voice popover
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState(null)
  const [runs, setRuns] = useState([])               // [{id, action, status, output}]
  const [activeId, setActiveId] = useState(null)     // job id being polled
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem(MODE_KEY) || 'dark' } catch { return 'dark' }
  })
  const appRef = useRef(null)

  const loadOverview = () =>
    api.overview().then(setOverview).catch((e) => setToast({ kind: 'err', msg: e.message }))

  useEffect(() => { loadOverview() }, [])
  useEffect(() => { api.themes().then((t) => setThemes(t.themes)).catch(() => {}) }, [])

  // Hydrate the console from the server's run history (survives reload and
  // restart); resume polling if a job is still running from a previous tab.
  useEffect(() => {
    api.jobs().then(({ jobs }) => {
      if (!jobs.length) return
      setRuns(jobs.map((j) => ({
        id: j.id, action: j.action, status: j.status,
        output: j.output || '', duration: j.duration,
      })))
      const running = jobs.find((j) => j.status === 'running')
      if (running) { setActiveId(running.id); setConsoleOpen(true) }
    }).catch(() => {})
  }, [])

  // The UI wears the deployed theme's accent, adjusted for light/dark mode.
  useEffect(() => {
    if (overview?.accent) applyAccent(appRef.current, overview.accent, mode)
  }, [overview, mode])
  useEffect(() => {
    try { localStorage.setItem(MODE_KEY, mode) } catch {}
  }, [mode])

  // Poll the running job, streaming output into its console run, then refresh.
  useEffect(() => {
    if (!activeId) return
    const t = setInterval(async () => {
      try {
        const j = await api.job(activeId)
        setRuns((rs) => rs.map((r) =>
          r.id === activeId
            ? { ...r, output: j.output || '', status: j.status, duration: j.duration }
            : r))
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

  const cancelJob = (id) =>
    api.cancelJob(id).catch((e) => setToast({ kind: 'err', msg: e.message }))

  return (
    <div className={`app ${mode === 'light' ? 'light' : ''}`} ref={appRef}>
      <div className="atmos" aria-hidden="true" />
      <Rail route={route} overview={overview}
        onOpenVoice={() => setVoiceOpen((v) => !v)} />
      {voiceOpen && (
        <VoicePopover themes={themes} current={overview?.theme}
          onPick={(name) => {
            setVoiceOpen(false)
            runAction('build', { theme: name, emit: overview?.emit })
          }}
          onClose={() => setVoiceOpen(false)} />
      )}
      <div className="col">
        <Topbar route={route} target={overview?.target} query={query} onQuery={setQuery}
          mode={mode} onToggleMode={() => setMode((m) => (m === 'light' ? 'dark' : 'light'))} />
        <div className="page">
          <div className="pad">
            {route.view === 'dashboard' &&
              <Dashboard overview={overview} themes={themes} onAction={runAction} />}
            {route.view === 'section' && <Section section={route.section} query={query} counts={overview?.counts} />}
            {route.view === 'item' &&
              <Section
                section={{ agent: 'agents', skill: 'skills', law: 'laws' }[route.type] || route.type}
                selected={route.name}
                query={query}
                counts={overview?.counts}
              />}
            {route.view === 'diff' && <Diff />}
            {route.view === 'doctor' && <Doctor />}
            {route.view === 'themes' && <Themes onAction={runAction} />}
            {route.view === 'graph' && <Graph />}
            {route.view === 'settings' && <Settings onAction={runAction} />}
          </div>
        </div>
        <Console runs={runs} open={consoleOpen} busy={!!activeId}
          onToggle={() => setConsoleOpen((v) => !v)} onClear={() => setRuns([])}
          onCancel={cancelJob} />
      </div>
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </div>
  )
}
