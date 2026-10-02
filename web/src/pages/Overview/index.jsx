import React, { lazy, Suspense, useState } from 'react'
import { api } from '../../api/index.js'
import { useAsync } from '../../hooks/useAsync.js'
import { relTime } from '../../lib/format.js'
import {
  constitutionMix,
  healthTone,
  needsAttention,
  runBars,
  skillsByStage,
} from '../../lib/overview.js'
import Loading from '../../components/Loading.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import Onboarding from '../Dashboard/Onboarding.jsx'
import { docsHostOf } from '../../hooks/useHarness.js'
import { readSeen, TRACK_GROUP } from '../Docs/Track.jsx'

const DISMISS_KEY = 'geneseed-newhere-dismissed'

// The four older dashboards, kept as alternate views of this page. Lazy: they are behind
// the Appearance palette's "Overview view", which most sessions never touch.
const Dashboard = lazy(() => import('../Dashboard/index.jsx'))

const pct = (n, of) => `${of ? (n / of) * 100 : 0}%`
const day = (epoch) =>
  epoch
    ? new Date(epoch * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : ''

function HealthBanner({ overview, setup }) {
  const tone = healthTone(overview, setup)
  const d = overview.doctor
  const diff = overview.diff
  const drift = diff ? diff.edited + diff.added + diff.missing : null
  const facts = [
    !d
      ? 'doctor not run yet'
      : d.ok
        ? `doctor clean${d.checked_at ? ` at ${d.checked_at.slice(-5)}` : ''}`
        : `doctor found ${d.problems.length} problem${d.problems.length === 1 ? '' : 's'}`,
    drift === null ? null : drift ? `${drift} file${drift === 1 ? '' : 's'} drifted` : 'no drift',
    !setup?.installed_fp
      ? null
      : setup.installed_fp === setup.source_fp
        ? 'install matches source'
        : 'install is behind its source',
  ].filter(Boolean)
  const head = {
    good: 'Harness healthy.',
    warn: 'Harness needs a look.',
    bad: 'Harness has problems.',
  }[tone]
  return (
    <div className={`health ${tone}`} role="status">
      <span className="health-dot" aria-hidden="true" />
      <p>
        <b>{head}</b> <span className="muted">{facts.join(' · ')}</span>{' '}
        {setup?.installed_fp ? <span className="mono dim">{setup.installed_fp}</span> : null}
      </p>
      <span className="mono dim health-built" title={overview.build_time || undefined}>
        {overview.build_epoch ? `built ${relTime(overview.build_epoch)} ago` : 'never built'}
      </span>
    </div>
  )
}

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

function ConstitutionCard({ counts, laws, rules }) {
  const rows = constitutionMix(counts, laws, rules?.stats)
  const total = rows.reduce((n, r) => n + r.n, 0)
  const inForce = rows[1].n + rows[2].n + rows[3].n
  return (
    <section className="panel chart-card" aria-labelledby="ov-const">
      <div className="panel-head">
        <h2 id="ov-const">Constitution</h2>
        <a className="mono dim" href="#/laws">
          {inForce} in force
        </a>
      </div>
      <div className="stackbar" aria-hidden="true">
        {rows.map((r) =>
          r.n ? (
            <span key={r.key} className={`sb-${r.key}`} style={{ width: pct(r.n, total) }} />
          ) : null,
        )}
      </div>
      <ul className="legend">
        {rows.map((r) => (
          <li key={r.key}>
            <span className={`swatch sb-${r.key}`} aria-hidden="true" />
            <span className="legend-label">
              {r.label} {r.note ? <span className="dim">({r.note})</span> : null}
            </span>
            <span className="mono">{r.n}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function SkillsCard({ skills }) {
  if (!skills) return <section className="panel chart-card" aria-busy="true" />
  const { rows, total, experimental, max } = skillsByStage(skills.items)
  return (
    <section className="panel chart-card" aria-labelledby="ov-skills">
      <div className="panel-head">
        <h2 id="ov-skills">Skills by stage</h2>
        <span className="mono dim">
          {total} · {experimental} experimental
        </span>
      </div>
      <ul className="hbars">
        {rows.map((r) => (
          <li key={r.key}>
            <span className="hb-label">{r.label}</span>
            <span className="hb-track" aria-hidden="true">
              <span className="hb-ok" style={{ width: pct(r.ok, max) }} />
              <span className="hb-exp" style={{ width: pct(r.exp, max) }} />
            </span>
            <span className="mono hb-n" aria-label={`${r.n}, ${r.exp} experimental`}>
              {r.n}
            </span>
          </li>
        ))}
      </ul>
      <div className="chart-key">
        <span>
          <i className="key-ok" /> approved
        </span>
        <span>
          <i className="key-exp" /> experimental
        </span>
      </div>
    </section>
  )
}

function RunsCard({ runs }) {
  const { bars, ok, longest } = runBars(runs)
  const first = (runs || []).filter((r) => r.status !== 'running').slice(-20)
  return (
    <section className="panel chart-card" aria-labelledby="ov-runs">
      <div className="panel-head">
        <h2 id="ov-runs">Runs · last {bars.length || 20}</h2>
        <span className={`mono ${ok === bars.length ? 't-good' : 't-warn'}`}>
          {bars.length ? `${ok}/${bars.length} ok` : 'none yet'}
        </span>
      </div>
      <div className="vbars" role="img" aria-label={`${bars.length} runs, ${ok} succeeded`}>
        {bars.map((b) => (
          <span
            key={b.id}
            title={b.tip}
            className={`vb-${b.ok ? b.kind : 'failed'}`}
            style={{ height: `${Math.round(b.h * 100)}%` }}
          />
        ))}
      </div>
      <div className="chart-axis mono dim">
        <span>{day(first[0]?.started)}</span>
        {bars.length ? <span>longest {longest.toFixed(1)} s</span> : null}
        <span>{day(first[first.length - 1]?.started)}</span>
      </div>
      <div className="chart-key">
        <span>
          <i className="vb-update" /> update
        </span>
        <span>
          <i className="vb-rebuild" /> rebuild
        </span>
        <span>
          <i className="vb-other" /> install / build
        </span>
      </div>
    </section>
  )
}

function NeedsAttention({ rows }) {
  return (
    <section className="panel" aria-labelledby="ov-needs">
      <div className="panel-head panel-head-rule">
        <h2 id="ov-needs">
          Needs attention <span className="mono dim">{rows.length}</span>
        </h2>
      </div>
      {rows.length ? (
        <ul className="needs">
          {rows.map((n) => (
            <li key={n.id}>
              <span className={`tag ${n.tone}`}>{n.tag}</span>
              <span className="needs-what">
                <b>{n.title}</b>
                {n.detail ? <span className="dim"> · {n.detail}</span> : null}
              </span>
              <span className="mono dim needs-where">{n.where}</span>
              <a className="needs-verb" href={n.href}>
                {n.verb}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="needs-empty">Nothing needs you.</p>
      )}
    </section>
  )
}

// The landing page. By default the new Overview (health, three charts, what needs you);
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
  const own = layout === 'overview' && !!overview?.deployed
  // Each fetch answers `null` on failure: a row that cannot be read is simply not
  // claimed (lib/overview.js), which beats an error panel for a list of nudges.
  const soft = (p) => p.catch(() => null)
  const none = Promise.resolve(null)
  const { data: rules } = useAsync(() => (own ? soft(api.rules()) : none), [own, dataRev])
  const { data: activity } = useAsync(() => (own ? soft(api.activity()) : none), [own, dataRev])
  const { data: profile } = useAsync(() => (own ? soft(api.profile()) : none), [own, dataRev])
  const { data: skills } = useAsync(
    () => (own ? soft(api.catalog('skills')) : none),
    [own, dataRev],
    'catalog:skills',
  )
  const { data: laws } = useAsync(
    () => (own ? soft(api.catalog('laws')) : none),
    [own, dataRev],
    'catalog:laws',
  )

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

  const needs = needsAttention({ overview, setup, rules, activity, profile, skills, laws })
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
      <NewHere harness={docsHostOf(overview.emit)} />
      {own ? (
        <div className="ov-stack">
          <HealthBanner overview={overview} setup={setup} />
          <div className="ov-charts">
            <ConstitutionCard counts={overview.counts} laws={laws} rules={rules} />
            <SkillsCard skills={skills} />
            <RunsCard runs={runs} />
          </div>
          <NeedsAttention rows={needs} />
        </div>
      ) : (
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
      )}
    </>
  )
}
