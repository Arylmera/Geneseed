import React, { lazy, Suspense, useState } from 'react'
import { api } from '../../api/index.js'
import { useAsync } from '../../hooks/useAsync.js'
import Loading from '../../components/Loading.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import Seg from '../../components/Seg.jsx'
import StaleBanner from '../../components/StaleBanner.jsx'
import Onboarding from '../Dashboard/Onboarding.jsx'
import Ledger, { OverviewHead } from './Ledger.jsx'
import { docsHostOf } from '../../hooks/useHarness.js'
import { installTag } from '../../lib/hosts.js'
import { LAYOUTS } from '../../hooks/useLayout.js'
import { readSeen, TRACK_GROUP } from '../../lib/track.js'

const DISMISS_KEY = 'geneseed-newhere-dismissed'

// The four older dashboards, kept as lenses of this page. Lazy: they are behind the header's View
// control, which most sessions never touch.
const Dashboard = lazy(() => import('../Dashboard/index.jsx'))

// "New here?": a pointer into the Docs' Understand track with the reader's progress on it.
// Gone for good once dismissed, or once every understand page has been read.
export function NewHere({ harness }) {
  const [dismissed, setDismissed] = useState(() => !!localStorage.getItem(DISMISS_KEY))
  const { data: menu } = useAsync(
    () => (dismissed ? Promise.resolve(null) : api.docs(harness).catch(() => null)),
    [dismissed, harness],
  )
  const pages = menu?.groups?.find((g) => g.id === TRACK_GROUP)?.pages || []
  const seen = readSeen()
  const next = pages.findIndex((p) => !seen.includes(p.id))
  if (dismissed || !pages.length || next < 0) return null
  const done = pages.filter((p) => seen.includes(p.id)).length
  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }
  return (
    <section className="newhere" aria-label="New here?">
      <div className="newhere-body">
        <b>New here? Understand your harness.</b>
        <p>
          {pages.length} short pages: what a harness is, what was installed, what changes in your
          day, and what is guaranteed.
        </p>
        {/* A meter with nothing on it is noise: it appears with the first page read. */}
        {done ? (
          <div className="newhere-dots" aria-label={`${done} of ${pages.length} read`}>
            {pages.map((p) => (
              <i key={p.id} className={seen.includes(p.id) ? 'f' : ''} />
            ))}
          </div>
        ) : null}
      </div>
      <a className="btn ghost" href={`#/docs/${encodeURIComponent(pages[next].id)}`}>
        {done ? `Continue · step ${next + 1}` : 'Start'}
      </a>
      <button
        type="button"
        className="newhere-x"
        onClick={dismiss}
        title="Dismiss for good"
        aria-label="Dismiss"
      >
        ×
      </button>
    </section>
  )
}

// The Overview's View control, the lens's one home: which of the five views this page shows. Both
// arms render it in the same header, so a lens is never a dead end back to the Ledger.
function ViewSeg({ layout, onLayout }) {
  return (
    <Seg aria-label="View">
      {LAYOUTS.map((l) => (
        <button
          key={l.id}
          type="button"
          className={layout === l.id ? 'on' : ''}
          aria-pressed={layout === l.id}
          title={l.tagline}
          onClick={() => onLayout(l.id)}
        >
          {l.short}
        </button>
      ))}
    </Seg>
  )
}

// The landing page. By default the Ledger (Ledger.jsx: every install, what needs you, cost, usage
// and gates); the View control swaps in one of the four older dashboards, and the choice persists
// (hooks/useLayout.js).
export default function Overview({
  overview,
  overviewError,
  onRetry,
  themes,
  setup,
  runs,
  onAction,
  layout = 'overview',
  onLayout,
  dataRev,
}) {
  // The fleet, for the onboarding gate: App's key and deps, so it shares App's cached answer once
  // either has loaded it. Wrapped, so an api without `installs` reads "unknown", not a throw.
  const { data: instData, loading: instLoading } = useAsync(
    () =>
      Promise.resolve()
        .then(() => api.installs())
        .catch(() => null),
    [dataRev],
    'installs',
  )
  if (!overview)
    return overviewError ? (
      <ErrorState
        error={`Could not load the harness overview: ${overviewError}`}
        onRetry={onRetry}
      />
    ) : (
      <Loading />
    )
  // Onboard only a machine with NO active install, read off the fleet. `deployed` (the default
  // install's manifest) decides until the fleet is read, so the Ledger's own fetches start now
  // instead of queueing behind `/api/installs`; a not-deployed machine waits to know, on the
  // FIRST read only: a refetch must not unmount Onboarding and lose what the user has filled in.
  const live = instData ? instData.installs?.some((i) => i.state === 'active') : overview.deployed
  if (!live) return instLoading && !instData ? <Loading /> : <Onboarding onAction={onAction} />

  const banner = <NewHere harness={docsHostOf(overview.emit)} />
  const view = onLayout ? <ViewSeg layout={layout} onLayout={onLayout} /> : null
  if (layout === 'overview') {
    return (
      <Ledger
        overview={overview}
        setup={setup}
        runs={runs}
        onAction={onAction}
        onRetry={onRetry}
        dataRev={dataRev}
        view={view}
        banner={
          <>
            {/* The older dashboards render their own (Dashboard/index.jsx). */}
            {overview.daemon_stale ? <StaleBanner /> : null}
            {banner}
          </>
        }
      />
    )
  }
  // One of the four older dashboards, under the Ledger's own header. The row under it is what a
  // lens lacks and the Ledger's health card holds: the facts it reads and its two actions.
  return (
    <>
      <OverviewHead
        // What is installed, on or off: the rail's figure, and what the Ledger's fleet lists.
        count={instData ? instData.installs.filter((i) => i.state !== 'absent').length : null}
        canFill={false}
        onAction={onAction}
        view={view}
        dataRev={dataRev}
      />
      {banner}
      <div className="head-row mb-16">
        {/* A lens's health facts are ONE install's (the default's overview), and the line names it
            first. Its counts cover every install, and the line says that too. */}
        <p className="sub">
          {[
            overview.install && installTag(overview.install),
            overview.theme && `${overview.theme} voice`,
            overview.footprint && `${overview.footprint} footprint`,
            overview.target,
            'counts cover every install',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <div className="row gap-10">
          <button type="button" className="btn ghost" onClick={() => onAction('doctor')}>
            Run doctor
          </button>
          {/* The machine-wide build-all: the lenses read no fleet, so they have no behind set to
              narrow it to. */}
          <button type="button" className="btn" onClick={() => onAction('build-all')}>
            Rebuild
          </button>
        </div>
      </div>
      <Suspense fallback={<Loading />}>
        <Dashboard
          overview={overview}
          overviewError={overviewError}
          onRetry={onRetry}
          themes={themes}
          setup={setup}
          runs={runs}
          onAction={onAction}
          layout={layout}
          dataRev={dataRev}
        />
      </Suspense>
    </>
  )
}
