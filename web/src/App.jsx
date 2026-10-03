import React, { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { api } from './api/index.js'
import { motionOK } from './lib/motion.js'
import { useRoute } from './lib/router.js'
import { applyAccent, applyCuratedAccent, applyHexAccent } from './lib/accents.js'
import { useColorMode } from './hooks/useColorMode.js'
import { useFlavour } from './hooks/useFlavour.js'
import { useAccentMode, customAccentName, pickedHex } from './hooks/useAccentMode.js'
import { useLayout } from './hooks/useLayout.js'
import { useOverview } from './hooks/useOverview.js'
import { useJobs } from './hooks/useJobs.js'
import { useAsync } from './hooks/useAsync.js'
import Sidebar, { TabBar } from './components/Sidebar.jsx'
import Topbar from './components/Topbar.jsx'
import VoicePopover from './components/VoicePopover.jsx'
import Toast from './components/Toast.jsx'
import Console from './components/Console.jsx'
import BootSplash from './components/BootSplash.jsx'
import Loading from './components/Loading.jsx'
import { ConfirmProvider } from './hooks/useConfirm.jsx'
// The Overview is the landing route, so it ships in the shell. Every other page is
// code-split: most sessions only ever open the console to the overview, and the rest
// (the harness manager, the docs viewer, the old dashboard lenses) would otherwise be
// downloaded and parsed before the first paint.
import Overview from './pages/Overview/index.jsx'
const Activity = lazy(() => import('./pages/Activity.jsx'))
const ActivityDetail = lazy(() => import('./pages/ActivityDetail.jsx'))
const Library = lazy(() => import('./pages/Library.jsx'))
const Loops = lazy(() => import('./pages/Loops.jsx'))
const Laws = lazy(() => import('./pages/Laws.jsx'))
const Personal = lazy(() => import('./pages/Personal.jsx'))
const Installs = lazy(() => import('./pages/Installs/index.jsx'))
const Docs = lazy(() => import('./pages/Docs/index.jsx'))

// App is a thin shell: it wires the hooks (overview, jobs, color mode) to the chrome
// (sidebar, topbar, console) and dispatches the active route to a page. All stateful
// logic lives in hooks/ and all chrome in components/.
export default function App() {
  const route = useRoute()
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState(null)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [mode, toggleMode] = useColorMode()
  const [flavour, setFlavour] = useFlavour()
  // A flavour swap re-skins the whole console at once (fonts, surfaces), so it crossfades
  // as one picture (View Transitions) instead of snapping. flushSync makes the new skin
  // land INSIDE the transition's callback, which is the snapshot it fades to. No API or
  // reduced motion: the plain swap.
  const switchFlavour = (f) => {
    if (!document.startViewTransition || !motionOK()) return setFlavour(f)
    document.startViewTransition(() => flushSync(() => setFlavour(f)))
  }
  const [accentMode, setAccentMode] = useAccentMode()
  const [layout, setLayout] = useLayout()
  // The splash plays on the first load of a browser session only. Storage can throw
  // (blocked site data): then the splash simply plays, rather than the app failing to mount.
  const [booting, setBooting] = useState(() => {
    try {
      return !window.sessionStorage.getItem('gs-booted')
    } catch {
      return true
    }
  })
  // Phone-width navigation. Above 720px the sidebar is always on screen and this stays
  // false; below it the sidebar is an off-canvas drawer this opens.
  const [navOpen, setNavOpen] = useState(false)
  const appRef = useRef(null)
  const colRef = useRef(null)

  // Esc closes the drawer, the one shortcut every drawer is expected to have.
  useEffect(() => {
    if (!navOpen) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setNavOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navOpen])

  // While the drawer is open, focus lives IN it: the main column goes `inert` so Tab
  // cannot land behind the scrim, focus moves into the sidebar, and on close it returns to
  // whatever opened the drawer. `inert` is set imperatively: React 18 doesn't forward it.
  useEffect(() => {
    if (!navOpen) return undefined
    const col = colRef.current
    const opener = document.activeElement
    if (col) col.inert = true
    document.getElementById('rail-nav')?.focus()
    return () => {
      if (col) col.inert = false
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [navOpen])

  const onError = (e) =>
    setToast({ kind: e?.body?.kind || 'err', msg: e?.body?.message || e.message })
  const { overview, error: overviewError, themes, reload } = useOverview(onError)
  const [dataRev, setDataRev] = useState(0)
  // Soft refresh after a mutation: refetch the overview and bump a revision every panel
  // depends on. No full page reload, so nothing flashes.
  const refresh = () => {
    reload()
    setDataRev((v) => v + 1)
  }
  // The moment a job the page was WATCHING ends, as an event ({ status, at }) rather than
  // a derived "last run": the console flash fires on this, and a run hydrated from the
  // history on load must not look like one that just finished.
  const [finish, setFinish] = useState(null)
  const { runs, activeId, consoleOpen, setConsoleOpen, runAction, cancelJob, clearRuns } = useJobs({
    onFinish: (status) => {
      refresh()
      setFinish({ status, at: Date.now() })
    },
    onError,
  })

  // The install snapshot (fingerprints, gate asks, facts) and the installs list: ONE
  // fetch each for the whole shell, refetched on `dataRev`. The sidebar, the topbar's
  // harness selector and the pages all read these copies.
  const { data: setup } = useAsync(() => api.setup().catch(() => null), [dataRev], 'setup')
  const { data: instData } = useAsync(() => api.installs().catch(() => null), [dataRev], 'installs')
  const installs = instData?.installs || null

  // One sentence describing what the job runner is doing, for the live region.
  const lastRun = runs[runs.length - 1]
  const jobAnnouncement = !lastRun
    ? ''
    : lastRun.status === 'running'
      ? `${lastRun.action} running`
      : `${lastRun.action} ${lastRun.status}`

  // The accent is a picked colour ('hex:#RRGGBB'), a fixed pick ('custom:<name>') or the
  // flavour's curated signature ('curated', the default), adjusted for light/dark. The
  // voice's accent is only the fallback for a flavour with no curated entry.
  useEffect(() => {
    const el = appRef.current
    if (!el) return
    if (applyHexAccent(el, pickedHex(accentMode), mode)) return
    const custom = customAccentName(accentMode)
    if (custom) return applyAccent(el, custom, mode)
    if (applyCuratedAccent(el, flavour, mode)) return
    if (overview?.accent) applyAccent(el, overview.accent, mode)
  }, [overview, mode, accentMode, flavour])

  const appearance = {
    flavour,
    onFlavour: switchFlavour,
    accentMode,
    onAccentMode: setAccentMode,
    layout,
    onLayout: setLayout,
  }

  // route.page -> its element. Keys are lib/router.js's PAGES.
  const pages = {
    overview: () => (
      <Overview
        overview={overview}
        overviewError={overviewError}
        onRetry={reload}
        themes={themes}
        setup={setup}
        runs={runs}
        onAction={runAction}
        layout={layout}
        dataRev={dataRev}
      />
    ),
    laws: () => (
      <Laws
        selected={route.item}
        overview={overview}
        setup={setup}
        onAction={runAction}
        dataRev={dataRev}
      />
    ),
    library: () => (
      <Library
        overview={overview}
        section={route.section}
        selected={route.item}
        dataRev={dataRev}
      />
    ),
    loops: () => <Loops tab={route.tab} item={route.item} dataRev={dataRev} />,
    personal: () => <Personal tab={route.tab} item={route.item} setup={setup} dataRev={dataRev} />,
    installs: () => (
      <Installs
        tab={route.tab}
        overview={overview}
        setup={setup}
        themes={themes}
        onAction={runAction}
        onMutated={refresh}
        dataRev={dataRev}
        appearance={appearance}
      />
    ),
    activity: () =>
      route.item ? <ActivityDetail key={route.item} sid={route.item} /> : <Activity />,
    docs: () => <Docs page={route.item} query={query} onAction={runAction} overview={overview} />,
  }

  return (
    <div
      className={`app fl-${flavour} ${mode === 'light' ? 'light' : ''}${navOpen ? ' nav-open' : ''}`}
      ref={appRef}
    >
      {/* One themed confirm for every page; see hooks/useConfirm.jsx for why it sits
          inside `.app`. */}
      <ConfirmProvider>
        <div className="atmos" aria-hidden="true" />
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {/* Actions (rebuild, update, doctor) run as background jobs whose only feedback
            is visual. Announce the transitions so a screen-reader user knows a job
            started and ended. */}
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
        <Sidebar
          route={route}
          overview={overview}
          installs={installs}
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
        <div className="col" ref={colRef}>
          <Topbar
            route={route}
            navOpen={navOpen}
            onToggleNav={() => setNavOpen((v) => !v)}
            overview={overview}
            installs={installs}
            query={query}
            onQuery={setQuery}
            mode={mode}
            onToggleMode={toggleMode}
            appearance={appearance}
            dataRev={dataRev}
            onSwitch={refresh}
          />
          <main className="page" id="main" tabIndex={-1}>
            <div className={route.page === 'library' ? 'pad pad-wide' : 'pad'}>
              <Suspense fallback={<Loading />}>
                {/* ⚠ ONE SLOT PER PAGE, AND IT IS NOT A TIDY-UP. A page reachable from
                  several routes (the Library from `#/skills`, `#/section/memory` and
                  `#/item/agent/x`; the Constitution from `#/laws` and `#/item/law/IV`)
                  must render from ONE position in this tree, or React unmounts and
                  remounts it whenever the route crosses between them: the page throws
                  its state away, refetches, flashes the spinner and loses the scroll
                  position. The resolver (lib/router.js) folds every route onto its page
                  and every page renders from this one expression, so React reconciles
                  by component type. Pinned by __tests__/app.routing.test.jsx. */}
                {pages[route.page]?.()}
              </Suspense>
            </div>
          </main>
          <TabBar route={route} />
          <Console
            runs={runs}
            open={consoleOpen}
            busy={!!activeId}
            finish={finish}
            onToggle={() => setConsoleOpen((v) => !v)}
            onClear={clearRuns}
            onCancel={cancelJob}
          />
        </div>
        {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
        {booting && (
          <BootSplash
            ready={!!overview || !!overviewError}
            onDone={() => {
              try {
                window.sessionStorage.setItem('gs-booted', '1')
              } catch {
                /* storage blocked: the splash plays again next load, nothing worse */
              }
              setBooting(false)
            }}
          />
        )}
      </ConfirmProvider>
    </div>
  )
}
