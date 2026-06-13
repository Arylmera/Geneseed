import React, { useEffect, useRef, useState } from 'react'
import { useRoute } from './lib/router.js'
import { applyAccent } from './lib/accents.js'
import { TYPE_TO_SECTION } from './lib/sections.js'
import { useColorMode } from './hooks/useColorMode.js'
import { useOverview } from './hooks/useOverview.js'
import { useJobs } from './hooks/useJobs.js'
import Rail from './components/Rail.jsx'
import Topbar from './components/Topbar.jsx'
import VoicePopover from './components/VoicePopover.jsx'
import Toast from './components/Toast.jsx'
import Console from './components/Console.jsx'
import Dashboard from './pages/Dashboard/index.jsx'
import Section from './pages/Section.jsx'
import Diff from './pages/Diff.jsx'
import Doctor from './pages/Doctor.jsx'
import Themes from './pages/Themes.jsx'
import Graph from './pages/Graph.jsx'
import Settings from './pages/Settings/index.jsx'

// App is a thin shell: it wires the hooks (overview, jobs, color mode) to the
// chrome (rail, topbar, console) and dispatches the active route to a page. All
// stateful logic lives in hooks/ and all chrome in components/ — this file just
// composes them, the way harness.py composes its submodules.
export default function App() {
  const route = useRoute()
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState(null)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [mode, toggleMode] = useColorMode()
  const appRef = useRef(null)

  const onError = (e) => setToast({ kind: 'err', msg: e.message })
  const { overview, themes, reload } = useOverview(onError)
  const { runs, activeId, consoleOpen, setConsoleOpen, runAction, cancelJob, clearRuns } = useJobs({
    onFinish: reload,
    onError,
  })

  // The UI wears the deployed theme's accent, adjusted for light/dark mode.
  useEffect(() => {
    if (overview?.accent) applyAccent(appRef.current, overview.accent, mode)
  }, [overview, mode])

  return (
    <div className={`app ${mode === 'light' ? 'light' : ''}`} ref={appRef}>
      <div className="atmos" aria-hidden="true" />
      <Rail route={route} overview={overview} onOpenVoice={() => setVoiceOpen((v) => !v)} />
      {voiceOpen && (
        <VoicePopover
          themes={themes}
          current={overview?.theme}
          onPick={(name) => {
            setVoiceOpen(false)
            runAction('build', { theme: name, emit: overview?.emit })
          }}
          onClose={() => setVoiceOpen(false)}
        />
      )}
      <div className="col">
        <Topbar
          route={route}
          target={overview?.target}
          query={query}
          onQuery={setQuery}
          mode={mode}
          onToggleMode={toggleMode}
        />
        <div className="page">
          <div className="pad">
            {route.view === 'dashboard' && (
              <Dashboard overview={overview} themes={themes} onAction={runAction} />
            )}
            {route.view === 'section' && (
              <Section section={route.section} query={query} counts={overview?.counts} />
            )}
            {route.view === 'item' && (
              <Section
                section={TYPE_TO_SECTION[route.type] || route.type}
                selected={route.name}
                query={query}
                counts={overview?.counts}
              />
            )}
            {route.view === 'diff' && <Diff />}
            {route.view === 'doctor' && <Doctor />}
            {route.view === 'themes' && <Themes onAction={runAction} />}
            {route.view === 'graph' && <Graph />}
            {route.view === 'settings' && <Settings onAction={runAction} />}
          </div>
        </div>
        <Console
          runs={runs}
          open={consoleOpen}
          busy={!!activeId}
          onToggle={() => setConsoleOpen((v) => !v)}
          onClear={clearRuns}
          onCancel={cancelJob}
        />
      </div>
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </div>
  )
}
