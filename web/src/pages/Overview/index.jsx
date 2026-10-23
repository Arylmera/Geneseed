import React, { lazy, Suspense, useState } from 'react'
import { api } from '../../api/index.js'
import { useAsync } from '../../hooks/useAsync.js'
import Loading from '../../components/Loading.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import StaleBanner from '../../components/StaleBanner.jsx'
import Onboarding from '../Dashboard/Onboarding.jsx'
import Ledger from './Ledger.jsx'
import { docsHostOf } from '../../hooks/useHarness.js'
import { readSeen, TRACK_GROUP } from '../Docs/Track.jsx'

const DISMISS_KEY = 'geneseed-newhere-dismissed'

// The four older dashboards, kept as alternate views of this page. Lazy: they are behind
// the Appearance palette's "Overview view", which most sessions never touch.
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
        <div className="newhere-dots" aria-label={`${done} of ${pages.length} read`}>
          {pages.map((p) => (
            <i key={p.id} className={seen.includes(p.id) ? 'f' : ''} />
          ))}
        </div>
      </div>
      <a className="btn" href={`#/docs/${encodeURIComponent(pages[next].id)}`}>
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

// The landing page. By default the Ledger (Ledger.jsx: every installed harness, what needs you,
// cost, usage and gates);
// the Appearance palette's "Overview view" swaps in one of the four older dashboards, and
// the choice persists (hooks/useLayout.js).
export default function Overview({
  overview,
  overviewError,
  onRetry,
  themes,
  setup,
  runs,
  onAction,
  layout = 'overview',
  dataRev,
}) {
  if (!overview)
    return overviewError ? (
      <div>
        <ErrorState error={`Could not load the harness overview: ${overviewError}`} />
        <button type="button" className="btn" onClick={onRetry}>
          Retry
        </button>
      </div>
    ) : (
      <Loading />
    )
  // Nothing deployed yet: onboard into a first deploy instead of an empty readout.
  if (!overview.deployed) return <Onboarding onAction={onAction} />

  const banner = <NewHere harness={docsHostOf(overview.emit)} />
  if (layout === 'overview') {
    return (
      <Ledger
        overview={overview}
        setup={setup}
        onAction={onAction}
        onRetry={onRetry}
        dataRev={dataRev}
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
  // One of the four older dashboards, chosen in the Appearance palette.
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="h">Overview</h1>
          <p className="sub">
            {[
              overview.theme && `${overview.theme} voice`,
              overview.footprint && `${overview.footprint} footprint`,
              overview.target,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn ghost" onClick={() => onAction('doctor')}>
            Run doctor
          </button>
          <button type="button" className="btn" onClick={() => onAction('build-all')}>
            Rebuild
          </button>
        </div>
      </div>
      {banner}
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
