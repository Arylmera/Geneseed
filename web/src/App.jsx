import React, { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { api } from './api/index.js'
import { useRoute } from './lib/router.js'
import { applyAccent, applyCuratedAccent } from './lib/accents.js'
import { TYPE_TO_SECTION } from './lib/sections.js'
import { useColorMode } from './hooks/useColorMode.js'
import { useFlavour } from './hooks/useFlavour.js'
import { useAccentMode } from './hooks/useAccentMode.js'
import { useLayout } from './hooks/useLayout.js'
import { useOverview } from './hooks/useOverview.js'
import { useJobs } from './hooks/useJobs.js'
import Rail from './components/Rail.jsx'
import Topbar from './components/Topbar.jsx'
import VoicePopover from './components/VoicePopover.jsx'
import Toast from './components/Toast.jsx'
import Console from './components/Console.jsx'
import BootSplash from './components/BootSplash.jsx'
import Loading from './components/Loading.jsx'
// Dashboard is the landing route, so it ships in the shell. Every other page is
// code-split: importing all fourteen statically put the whole console — graph
// rendering, the harness manager, the docs viewer — into one chunk that had to be
// downloaded and parsed before the dashboard could paint, on a tool most sessions
// only ever open to the dashboard.
import Dashboard from './pages/Dashboard/index.jsx'
const Activity = lazy(() => import('./pages/Activity.jsx'))
const ActivityDetail = lazy(() => import('./pages/ActivityDetail.jsx'))
const Library = lazy(() => import('./pages/Library.jsx'))
const Laws = lazy(() => import('./pages/Laws.jsx'))
const Rules = lazy(() => import('./pages/Rules.jsx'))
const Profile = lazy(() => import('./pages/Profile.jsx'))
const Skills = lazy(() => import('./pages/Skills.jsx'))
const Diff = lazy(() => import('./pages/Diff.jsx'))
const Doctor = lazy(() => import('./pages/Doctor.jsx'))
const Graph = lazy(() => import('./pages/Graph.jsx'))
const Settings = lazy(() => import('./pages/Settings/index.jsx'))
const Harness = lazy(() => import('./pages/Harness.jsx'))
const Docs = lazy(() => import('./pages/Docs/index.jsx'))

// App is a thin shell: it wires the hooks (overview, jobs, color mode) to the
// chrome (rail, topbar, console) and dispatches the active route to a page. All
// stateful logic lives in hooks/ and all chrome in components/ — this file just
// composes them, the way the CLI entry point composes its submodules.
export default function App() {
  const route = useRoute()
  // Which page each route lands on, derived ONCE so each page has exactly one slot in the tree
  // below — see the ⚠ beside them. A route only ever selects one of these three.
  const isSection = route.view === 'section'
  const isItem = route.view === 'item'
  const showLaws =
    route.view === 'laws' ||
    (isSection && route.section === 'laws') ||
    (isItem && route.type === 'law')
  const showSkills =
    route.view === 'skills' ||
    (isSection && route.section === 'skills') ||
    (isItem && route.type === 'skill')
  const showLibrary =
    route.view === 'library' ||
    route.view === 'agents' ||
    ((isSection || isItem) && !showLaws && !showSkills)
  // `#/library` alone carries no section — Library reads that as "all of them".
  const librarySection =
    route.view === 'agents'
      ? 'agents'
      : isSection
        ? route.section
        : isItem
          ? TYPE_TO_SECTION[route.type] || route.type
          : undefined
  const selectedItem = isItem ? route.name : undefined
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState(null)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [stopped, setStopped] = useState(false)
  const [mode, toggleMode] = useColorMode()
  const [flavour, setFlavour] = useFlavour()
  const [accentMode, setAccentMode] = useAccentMode()
  const [layout, setLayout] = useLayout()
  // The splash plays on the first load of a browser session only; reloads and
  // route round-trips within the same tab skip straight to the dashboard.
  const [booting, setBooting] = useState(() => !window.sessionStorage.getItem('gs-booted'))
  // Phone-width navigation. Above 720px the rail is always on screen and this
  // stays false; below it the rail is an off-canvas drawer this opens.
  const [navOpen, setNavOpen] = useState(false)
  const appRef = useRef(null)

  // Esc closes the drawer, the one shortcut every drawer is expected to have.
  useEffect(() => {
    if (!navOpen) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setNavOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navOpen])

  const onError = (e) =>
    setToast({ kind: e?.body?.kind || 'err', msg: e?.body?.message || e.message })
  const { overview, themes, reload } = useOverview(onError)
  const [dataRev, setDataRev] = useState(0)
  // Soft refresh after a mutation: refetch the overview (dashboard accent + counts) and
  // bump a revision the install/MCP panels depend on — no full page reload, so no flash.
  const refresh = () => {
    reload()
    setDataRev((v) => v + 1)
  }
  const { runs, activeId, consoleOpen, setConsoleOpen, runAction, cancelJob, clearRuns } = useJobs({
    onFinish: refresh,
    onError,
  })

  // The install snapshot (fingerprints + version verdict). ONE fetch for the whole shell:
  // the rail's germination ring and the dashboard's Status/Lineage/Operator views all read
  // it, and it was being fetched twice — once for the dashboard, once for the rail — for the
  // same two fields. Refetched on `dataRev` so a rebuild moves the ring with everything else.
  const [setup, setSetup] = useState(null)
  useEffect(() => {
    let alive = true
    api
      .setup()
      .then((v) => alive && setSetup(v))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [dataRev])

  // One sentence describing what the job runner is doing, for the live region.
  const lastRun = runs[runs.length - 1]
  const jobAnnouncement = !lastRun
    ? ''
    : lastRun.status === 'running'
      ? `${lastRun.action} running`
      : `${lastRun.action} ${lastRun.status}`

  // The accent is either the flavour's curated signature ('curated' mode) or the
  // deployed voice's accent ('auto'), adjusted for light/dark. Curated wins when
  // the flavour has an entry; otherwise we always fall back to the voice.
  useEffect(() => {
    const el = appRef.current
    if (!el) return
    if (accentMode === 'curated' && applyCuratedAccent(el, flavour, mode)) return
    if (overview?.accent) applyAccent(el, overview.accent, mode)
  }, [overview, mode, accentMode, flavour])

  // Stop the local server (same /api/shutdown the Settings card uses). The
  // connection drops as the server goes down, so a rejected request right
  // after the call is still a successful stop.
  const handleShutdown = async () => {
    if (
      !window.confirm(
        'Stop the local Geneseed server? The console goes offline until you start it again.',
      )
    )
      return
    try {
      await api.shutdown()
    } catch {
      // server dropped the connection while shutting down — expected
    }
    setStopped(true)
  }

  if (stopped) {
    return (
      <div className={`app fl-${flavour} ${mode === 'light' ? 'light' : ''}`} ref={appRef}>
        <div className="atmos" aria-hidden="true" />
        <div className="page" style={{ display: 'grid', placeItems: 'center' }}>
          <p className="sub" style={{ textAlign: 'center', maxWidth: 480 }}>
            Server stopped. You can close this tab and reopen any time with{' '}
            <code>geneseed web</code>.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`app fl-${flavour} ${mode === 'light' ? 'light' : ''}${navOpen ? ' nav-open' : ''}`}
      ref={appRef}
    >
      <div className="atmos" aria-hidden="true" />
      {/* Keyboard users land on the rail's fourteen nav items before any page
          content; this jumps past them. Visible only while focused. */}
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {/* Actions (rebuild, update, doctor) run as background jobs whose only
          feedback was visual — the console panel and a spinner. Announce the
          transitions so a screen-reader user knows a job started and ended. */}
      <p className="sr-only" role="status" aria-live="polite">
        {jobAnnouncement}
      </p>
      {navOpen && (
        <button
          type="button"
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      )}
      <Rail
        route={route}
        overview={overview}
        setup={setup}
        onOpenVoice={() => setVoiceOpen((v) => !v)}
        onNavigate={() => setNavOpen(false)}
      />
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
          navOpen={navOpen}
          onToggleNav={() => setNavOpen((v) => !v)}
          target={overview?.target}
          version={overview?.version}
          query={query}
          onQuery={setQuery}
          mode={mode}
          onToggleMode={toggleMode}
          onShutdown={handleShutdown}
          dataRev={dataRev}
          onSwitch={refresh}
        />
        <main className="page" id="main" tabIndex={-1}>
          <div className={route.view === 'harness' ? 'pad pad-wide' : 'pad'}>
            <Suspense fallback={<Loading />}>
              {route.view === 'dashboard' && (
                <Dashboard
                  overview={overview}
                  themes={themes}
                  setup={setup}
                  onAction={runAction}
                  flavour={flavour}
                  layout={layout}
                />
              )}
              {route.view === 'activity' && <Activity />}
              {route.view === 'activity-detail' && (
                <ActivityDetail key={route.sid} sid={route.sid} />
              )}
              {/* ⚠ ONE SLOT PER PAGE, AND IT IS NOT A TIDY-UP. `Laws`, `Skills` and `Library`
                  are each reachable from three routes — the flat view, `#/section/<name>` and
                  `#/item/<type>/<name>` — and rendering them from three different positions in
                  this tree made React UNMOUNT and remount the whole page whenever the route
                  crossed between them. Expanding a row does exactly that (`#/laws` ->
                  `#/item/law/craft.1`), so the page threw away its state, refetched its
                  catalogue, flashed the spinner and lost the scroll position. Only on the
                  FIRST expand — a second row is `item` -> `item`, same slot, no remount —
                  which is what made it look intermittent rather than broken. Deriving the
                  props and rendering from one slot each lets React reconcile instead. */}
              {showLaws && (
                <Laws selected={selectedItem} overview={overview} onAction={runAction} />
              )}
              {showSkills && <Skills selected={selectedItem} />}
              {showLibrary && (
                <Library
                  overview={overview}
                  section={librarySection}
                  selected={selectedItem}
                  dataRev={dataRev}
                />
              )}
              {route.view === 'rules' && <Rules />}
              {route.view === 'profile' && <Profile />}
              {route.view === 'diff' && <Diff onMutated={reload} dataRev={dataRev} />}
              {route.view === 'doctor' && <Doctor />}
              {route.view === 'graph' && <Graph />}
              {route.view === 'settings' && (
                <Settings
                  overview={overview}
                  onAction={runAction}
                  flavour={flavour}
                  onFlavour={setFlavour}
                  accentMode={accentMode}
                  onAccentMode={setAccentMode}
                  layout={layout}
                  onLayout={setLayout}
                />
              )}
              {route.view === 'harness' && (
                <Harness
                  onAction={runAction}
                  themes={themes}
                  currentTheme={overview?.theme}
                  overview={overview}
                  dataRev={dataRev}
                  onMutated={refresh}
                />
              )}
              {route.view === 'docs' && (
                <Docs page={route.page} query={query} onAction={runAction} overview={overview} />
              )}
            </Suspense>
          </div>
        </main>
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
      {booting && (
        <BootSplash
          ready={!!overview}
          onDone={() => {
            window.sessionStorage.setItem('gs-booted', '1')
            setBooting(false)
          }}
        />
      )}
    </div>
  )
}
