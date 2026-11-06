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
// sub-views share, then renders the chosen one. The Status sub-view is laid out by the lens,
// chosen independently of the skin: Genome's hero+kpi+genome, Greenhouse's ring+tiles+donut,
// the HUD's strip+modules, or the Journal's rings+map. Lineage and Readout stay one shared
// layout (they're optional data dives, not layout variants).
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
  layout = 'genome',
  dataRev,
}) {
  const lens = layout
  const [dir, setDir] = useState('status')
  // A lens lays out the Status direction alone, so choosing one from Lineage must land on it.
  const [seenLens, setSeenLens] = useState(lens)
  if (seenLens !== lens) {
    setSeenLens(lens)
    setDir('status')
  }
  const sigil = overview ? themes.find((t) => t.name === overview.theme)?.sigil || '' : ''

  // The fleet verdict every hero shows, and the doctor run — only Greenhouse (ring + check
  // chips) and the HUD (check matrix) read it, so Genome skips that round-trip. A
  // failed doctor is its own state (`lensData.doctor.state`), never a silent "still loading".
  const lensData = useLensData({
    dataRev,
    needDoctor: lens === 'greenhouse' || lens === 'hud',
  })
  // Recency stats every file-backed entry in the harness server-side, so it is
  // fetched by the one lens that shows it and by nothing else.
  const { data: recent } = useAsync(
    () => (lens === 'journal' ? api.recent().catch(() => null) : Promise.resolve(null)),
    [lens, dataRev],
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

  return (
    <>
      {stale}
      <div className="head-row">
        <Seg aria-label="Dashboard view">
          {[
            ['status', 'Status'],
            ['lineage', 'Lineage'],
            ['readout', 'Readout'],
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
        {dir === 'status' && lens === 'genome' && (
          <StatusView
            overview={overview}
            sigil={sigil}
            setup={setup}
            jobs={jobs}
            lens={lensData}
            dataRev={dataRev}
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
        {dir === 'status' && lens === 'hud' && (
          <Suspense fallback={<Loading />}>
            <OperatorHudView overview={overview} jobs={jobs} lens={lensData} />
          </Suspense>
        )}
        {dir === 'status' && lens === 'journal' && (
          <Suspense fallback={<Loading />}>
            <JournalView overview={overview} recent={recent} lens={lensData} dataRev={dataRev} />
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
        {dir === 'readout' && (
          <OperatorView overview={overview} setup={setup} jobs={jobs} lens={lensData} />
        )}
      </div>
    </>
  )
}
