import React, { lazy, Suspense, useState } from 'react'
import { api } from '../../api/index.js'
import StatusView from './StatusView.jsx'
import LineageView from './LineageView.jsx'
import OperatorView from './OperatorView.jsx'
import Onboarding from './Onboarding.jsx'
import Loading from '../../components/Loading.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import Seg from '../../components/Seg.jsx'
import StaleBanner from '../../components/StaleBanner.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useLensData } from '../../hooks/useLensData.js'

// Dashboard ships in the eager shell chunk (it is the landing route), so only
// the DEFAULT lens rides along. The alternative lenses are behind the layout
// toggle most sessions never flip — lazy chunks, fetched on first use. Journal
// pulls the ConstitutionMap, the heaviest of the three.
const GreenhouseView = lazy(() => import('./GreenhouseView.jsx'))
const OperatorHudView = lazy(() => import('./OperatorHudView.jsx'))
const JournalView = lazy(() => import('./JournalView.jsx'))

// The dashboard shell: loads the supplementary data (fleet verdict, doctor, recency) the
// directions share, then renders the chosen direction. The Status lens is a layout
// chosen independently of the flavour (skin) — Cultivar's hero+kpi+genome,
// Greenhouse's ring+tiles+donut, Operator HUD's strip+modules, or the Journal's
// rings+map — while Lineage and Operator stay one shared layout (they're optional
// data dives, not layout variants).
//
// `setup` and `runs` (job history) arrive as props rather than being fetched here:
// the rail and the console own those same copies, and App owns the one fetch of
// each — so they stay live while a job streams instead of showing a stale snapshot.
export default function Dashboard({
  overview,
  overviewError,
  onRetry,
  themes,
  setup,
  runs: jobs,
  onAction,
  layout = 'cultivar',
  dataRev,
}) {
  const lens = layout
  const [dir, setDir] = useState('status')
  const sigil = overview ? themes.find((t) => t.name === overview.theme)?.sigil || '' : ''

  // The fleet verdict every hero shows, and the doctor run — only Greenhouse (ring + check
  // chips) and Operator HUD (check matrix) read it, so Cultivar skips that round-trip. A
  // failed doctor is its own state (`lensData.doctor.state`), never a silent "still loading".
  const lensData = useLensData({
    dataRev,
    needDoctor: lens === 'greenhouse' || lens === 'operator',
  })
  // Recency stats every file-backed entry in the harness server-side, so it is
  // fetched by the one lens that shows it and by nothing else.
  const { data: recent } = useAsync(
    () => (lens === 'journal' ? api.recent().catch(() => null) : Promise.resolve(null)),
    [lens, dataRev],
  )

  if (!overview)
    return overviewError ? (
      <div>
        <ErrorState error={`Could not load the harness overview: ${overviewError}`} />
        <button className="btn" onClick={onRetry}>
          Retry
        </button>
      </div>
    ) : (
      <Loading />
    )

  // Above every arm below: a console serving pre-upgrade code is broken in any of them.
  const stale = overview.daemon_stale ? <StaleBanner /> : null

  // Nothing deployed yet → onboard the user into a first deploy instead of
  // showing an empty, read-only dashboard.
  if (!overview.deployed)
    return (
      <>
        {stale}
        <Onboarding onAction={onAction} />
      </>
    )

  // The Journal lens is a page, not a panel: it brings its own header (the field
  // journal's date line and its two actions), so the shared head-row and the
  // direction switcher would be a second, contradictory title above it. Lineage
  // and Operator stay reachable from the rail's Activity/Changes rows and from
  // Settings' layout picker — the switcher returns with any other lens.
  if (dir === 'status' && lens === 'journal')
    return (
      <Suspense fallback={<Loading />}>
        {stale}
        <JournalView
          overview={overview}
          recent={recent}
          lens={lensData}
          onAction={onAction}
          onDirection={setDir}
          dataRev={dataRev}
        />
      </Suspense>
    )

  return (
    <>
      {stale}
      <div className="head-row">
        <Seg aria-label="Dashboard view">
          {[
            ['status', 'Status'],
            ['lineage', 'Lineage'],
            ['operator', 'Operator'],
          ].map(([k, l]) => (
            <button
              key={k}
              className={dir === k ? 'on' : ''}
              onClick={() => setDir(k)}
              aria-pressed={dir === k}
            >
              {l}
            </button>
          ))}
        </Seg>
      </div>
      {/* keyed by the direction, so switching tabs remounts this and replays .view-in: the
          new view settles in rather than replacing the old one in a single frame */}
      <div key={dir} className="view-in">
        {dir === 'status' && lens === 'cultivar' && (
          <StatusView
            overview={overview}
            sigil={sigil}
            setup={setup}
            jobs={jobs}
            lens={lensData}
            onAction={onAction}
          />
        )}
        {dir === 'status' && lens === 'greenhouse' && (
          <Suspense fallback={<Loading />}>
            <GreenhouseView
              overview={overview}
              sigil={sigil}
              jobs={jobs}
              lens={lensData}
              onAction={onAction}
            />
          </Suspense>
        )}
        {dir === 'status' && lens === 'operator' && (
          <Suspense fallback={<Loading />}>
            <OperatorHudView overview={overview} jobs={jobs} lens={lensData} onAction={onAction} />
          </Suspense>
        )}
        {dir === 'lineage' && (
          <LineageView
            overview={overview}
            sigil={sigil}
            setup={setup}
            jobs={jobs}
            lens={lensData}
          />
        )}
        {dir === 'operator' && (
          <OperatorView overview={overview} setup={setup} jobs={jobs} lens={lensData} />
        )}
      </div>
    </>
  )
}
