import React, { useEffect, useRef, useState } from 'react'
import { api } from '../../api/index.js'
import { useAsync } from '../../hooks/useAsync.js'
import { useConfirm } from '../../hooks/useConfirm.jsx'
import { useRules } from '../../hooks/useRules.js'
import { driftTotal, relTime } from '../../lib/format.js'
import PageHeader from '../../components/PageHeader.jsx'
import Ring from '../../components/Ring.jsx'
import StackBar, { Bar } from '../../components/StackBar.jsx'
import { Spark } from '../../lib/activity.jsx'
import { CountUp, useCountUp } from '../../lib/motion.js'
import {
  COST_PARTS,
  approxTokens,
  costTotal,
  fleetVerdict,
  ledgerNeeds,
  needsRebuild,
  neverFired,
  rebuildTarget,
} from '../../lib/overview.js'
import { alwaysOnRange, gateSummary, usageTotal, worstRootFile } from './ledgerKpi.js'

// The Ledger: the Overview as a control panel over every INSTALLED harness on the machine.
// The health card (verdict and actions), four KPIs, the fleet, then what needs you and what
// fires; each fleet row opens a details row with its cost breakdown. Hosts with nothing
// installed are not listed; installing lives on the Installs page with its other settings.
// Every read but the fleet degrades to null (a soft fetch), and a part that has no data says so
// in words. The fleet is the page's spine, so its failure is said out loud, with a Retry.

const soft = (p) => p.catch(() => null)
const pct = (n, of) => `${of ? Math.min(100, (n / of) * 100) : 0}%`

// The page re-asks /api/update this often while it stays open, and again when its tab comes
// back into view. The daemon answers from its own once-a-day check, so this costs no upstream
// request; it only bounds how long an open page goes without learning what the daemon learnt.
export const UPDATE_POLL_MS = 60 * 60 * 1000

// `canFill` false: the page already has its one primary (a rebuild is due), so a due Update
// stays ghost instead of becoming a second filled button.
function VersionChip({ update, onAction, canFill = true }) {
  if (!update) return null
  // `install` picks the route; a daemon older than the field only sent `git`.
  const install = update.install ?? (update.git ? 'git' : 'npm-global')
  const behind = install === 'git' && typeof update.behind === 'number' ? update.behind : null
  const chip =
    behind !== null ? (
      behind > 0 ? (
        <span className="mono ver-chip">
          {update.current ?? ''}{' '}
          <span className="ver-new">
            {behind} commit{behind === 1 ? '' : 's'} to pull
          </span>
        </span>
      ) : (
        <span className="mono dim ver-chip">{update.current ?? ''} · up to date</span>
      )
    ) : update.latest === null ? (
      <span className="mono dim ver-chip">{update.current ?? ''} · update check unavailable</span>
    ) : update.available ? (
      <span className="mono ver-chip">
        {update.current} <span className="ver-new">{update.latest} available</span>
      </span>
    ) : (
      <span className="mono dim ver-chip">{update.current} · latest</span>
    )
  // A copy the console cannot update itself gets the command to run, never a button that fails.
  if (install === 'other') {
    if (!update.available || !update.command) return chip
    return (
      <>
        {chip}
        <span className="dim">
          update with <code className="mono">{update.command}</code>
        </span>
      </>
    )
  }
  // A git clone can always pull: main moves between releases, and the release check may be
  // unanswered behind a proxy. An npm install updates only when a release is out.
  if (install !== 'git' && !update.available) return chip
  const due = behind === null ? Boolean(update.available) : behind > 0
  const title =
    install === 'git'
      ? behind === 0
        ? 'Nothing to pull: up to date with upstream. Pulls and rebuilds every install anyway.'
        : 'git pull, then rebuild every install'
      : 'npm install -g geneseed@latest, then rebuild every install'
  return (
    <>
      {chip}
      <button
        type="button"
        className={due && canFill ? 'btn' : 'btn ghost'}
        title={title}
        onClick={() => onAction('update')}
      >
        Update
      </button>
    </>
  )
}

// The verdict's mark: a check, a triangle or a cross, drawn in the card's tone (CSS `stroke`).
const HEALTH_ICON = {
  good: 'M8 12.5l2.7 2.7L16 9.5M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  warn: 'M12 3 22 20H2zM12 10v4M12 17v.5',
  bad: 'M9 9l6 6M15 9l-6 6M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
}
function HealthIcon({ tone }) {
  return (
    <svg className="health-ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d={HEALTH_ICON[tone] || HEALTH_ICON.warn} />
    </svg>
  )
}

// The health card: the verdict, and the page's actions beside it. `role="status"` sits on the
// text alone, so a screen reader announces the verdict, never the button labels.
function Health({ fleet, error, behind, onAction, onRebuild }) {
  const doctor = (
    <button type="button" className="btn ghost ldg-doctor" onClick={() => onAction('doctor')}>
      Run doctor
    </button>
  )
  if (!fleet) {
    // A failed read is not a load in progress: no aria-busy, and no claim either way.
    return error ? (
      <section className="health unknown" aria-labelledby="ldg-health">
        <HealthIcon tone="warn" />
        <div className="health-text" role="status">
          <h2 id="ldg-health">Status unknown</h2>
        </div>
        <div className="health-acts">{doctor}</div>
      </section>
    ) : (
      <div className="health unknown" aria-busy="true" />
    )
  }
  const v = fleetVerdict(fleet)
  const facts = [...v.facts, ...(fleet.version ? [`Source is ${fleet.version}`] : [])]
  return (
    <section className={`health ${v.tone}`} aria-labelledby="ldg-health">
      <HealthIcon tone={v.tone} />
      <div className="health-text" role="status">
        <h2 id="ldg-health">{v.head}</h2>
        <p className="health-facts">{facts.join(' · ')}.</p>
      </div>
      <div className="health-acts">
        {doctor}
        {/* One primary per page: a rebuild that is due outranks an update that is due. It
            rebuilds only the N installs that need it, each named in the confirm. */}
        {behind.length ? (
          <button
            type="button"
            className="btn"
            title={`Rebuilds ${behind.map((t) => t.label).join(', ')}`}
            onClick={() => onRebuild(behind)}
          >
            Rebuild all behind ({behind.length})
          </button>
        ) : null}
      </div>
    </section>
  )
}

// The always-on figure travelling up to its value; CountUp rounds to an integer, and this
// figure is a one-decimal thousand.
function TokCount({ chars }) {
  const n = useCountUp(chars)
  return <span className="mono">{approxTokens(n ?? chars)} tok</span>
}

// Characters as the ≈ tokens the console shows (÷ 4), for the bars and rings that print counts.
const tok = (chars) => Math.round(chars / 4)
const PART_TONE = { carrier: 'accent', skills: 'skill', agents: 'agent', context: 'context' }
const costParts = (c) =>
  COST_PARTS.map(([k, l]) => ({ key: k, label: l, n: tok(c[k]), tone: PART_TONE[k] }))
const labelOf = (i) => `${i.host} · ${i.scope}`

// The carrier against its ceiling, as a small ring: the phone card's root-file mark (CSS shows
// it only at phone width). Decorative: the row's own cells carry the figure in words.
function CarrierRing({ cost, i }) {
  const R = 14
  const circ = 2 * Math.PI * R
  const p = cost.ceiling ? Math.min(1, cost.carrier / cost.ceiling) : 0
  return (
    <svg className="ldg-ring" viewBox="0 0 36 36" aria-hidden="true">
      <circle className="bg" cx="18" cy="18" r={R} />
      <circle
        className={'fg' + (cost.ceiling && cost.carrier > cost.ceiling ? ' over' : '')}
        cx="18"
        cy="18"
        r={R}
        strokeDasharray={circ.toFixed(2)}
        strokeDashoffset={(circ * (1 - p)).toFixed(2)}
        style={{ '--circ': circ.toFixed(2), '--i': i }}
      />
    </svg>
  )
}

// ---- the KPI row ----

function Kpi({ id, title, aside, className = '', children }) {
  return (
    <section className={`panel ldg-kpi ${className}`} aria-labelledby={id}>
      <div className="ldg-kpi-head">
        <h3 id={id}>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function RootKpi({ installs }) {
  const w = worstRootFile(installs)
  return (
    <Kpi id="ldg-k-root" title="Root file vs ceiling" className="ldg-kpi-root">
      {w ? (
        <div className="ldg-kpi-ring">
          <span className="ldg-ringbox">
            {/* Past its ceiling the ring is full and reads bad, as the row's bar does. */}
            <Ring
              value={tok(w.carrier)}
              max={tok(w.ceiling)}
              segments={
                w.pct > 100
                  ? [{ key: 'v', label: 'root file', n: tok(w.carrier), tone: 'bad' }]
                  : undefined
              }
              size={64}
              stroke={7}
              label={`Worst root file: ${w.label}, ${w.pct} percent of its ceiling`}
            />
            <span className="mono ldg-ring-pct" aria-hidden="true">
              {w.pct}%
            </span>
          </span>
          <span className="ldg-kpi-stack">
            <span className="mono ldg-kpi-fig">{`${approxTokens(w.carrier)} / ${approxTokens(w.ceiling)} tokens`}</span>
            <span className="dim">{w.label}</span>
          </span>
        </div>
      ) : (
        <p className="dim">No root file to measure.</p>
      )}
    </Kpi>
  )
}

function CostKpi({ installs }) {
  const r = alwaysOnRange(installs)
  const span =
    r &&
    (approxTokens(r.min) === approxTokens(r.max)
      ? approxTokens(r.max)
      : `${approxTokens(r.min)} – ${approxTokens(r.max)}`)
  return (
    <Kpi id="ldg-k-cost" title="Always-on cost per turn" className="ldg-kpi-cost">
      {r ? (
        <>
          <span className="mono ldg-kpi-fig">{`${span} tokens`}</span>
          <StackBar
            parts={costParts(r.top.cost)}
            label={`Most expensive, ${labelOf(r.top)}`}
            legend={false}
          />
          <span className="dim ldg-kpi-cap">{`Bar: ${labelOf(r.top)}, the most expensive`}</span>
        </>
      ) : (
        <p className="dim">No install has a root file to measure.</p>
      )}
    </Kpi>
  )
}

function CallsKpi({ usage }) {
  // `per_day` always spans the last 30 days, so the figure is named "since" only while fewer
  // than 30 are counted; past that, an older `since` would pass a 30-day sum off as all-time.
  const since = !usage?.enabled
    ? null
    : usage.days_counted < 30 && usage.since
      ? `since ${usage.since}`
      : '30 days'
  return (
    <Kpi
      id="ldg-k-calls"
      title="Skill and agent calls"
      className="ldg-kpi-calls"
      aside={since ? <span className="mono dim ldg-kpi-aside">{since}</span> : null}
    >
      {!usage ? (
        <p className="dim">Usage could not be read.</p>
      ) : !usage.enabled ? (
        <p className="dim">Usage counting is off on this machine.</p>
      ) : (
        <>
          <span className="mono ldg-kpi-fig">
            <CountUp value={usageTotal(usage)} />
          </span>
          {usage.per_day?.length > 1 ? <Spark vals={usage.per_day} i={0} /> : null}
        </>
      )}
    </Kpi>
  )
}

function GatesKpi({ gates, laws }) {
  const g = gateSummary(gates, laws)
  return (
    <Kpi
      id="ldg-k-gates"
      title="Gate asks · 30 days"
      className="ldg-kpi-gates"
      aside={
        <a className="ldg-kpi-aside" href="#/laws" aria-label="Open the Constitution">
          Constitution →
        </a>
      }
    >
      {!gates ? (
        <p className="dim">Gate activity could not be read.</p>
      ) : !g.total ? (
        <p className="dim">No gate asked in 30 days.</p>
      ) : (
        <>
          <span className="ldg-kpi-line">
            <span className="mono ldg-kpi-fig">{g.total}</span>{' '}
            <span className="dim">{`· ${g.top.name} ${g.top.n}`}</span>
          </span>
          {g.perDay.length > 1 ? <Spark vals={g.perDay} i={1} /> : null}
        </>
      )}
    </Kpi>
  )
}

// ---- the fleet table ----

const COLS = 6

function SyncCell({ i }) {
  if (!i.diffable) {
    return (
      <span className="dim" title="Drift is only checked for global installs">
        not checkable
      </span>
    )
  }
  const drift = driftTotal(i.drift)
  // Unedited files the source has moved past: part of being behind, never a hand edit.
  const stale = i.drift?.stale ?? 0
  return (
    <>
      <span className="ldg-syncbar">
        <StackBar
          parts={[
            { key: 'stale', label: 'Behind source', n: stale, tone: 'warn' },
            { key: 'edited', label: 'Edited by hand', n: drift, tone: 'bad' },
          ]}
          label={`Sync with source, ${labelOf(i)}`}
          legend={false}
        />
      </span>
      {drift ? (
        <span className="mono t-bad">{drift} edited</span>
      ) : i.drift?.linked ? (
        // The user's own links: shown, so their absence from the count is explained, but
        // muted and with no Rebuild, because no rebuild clears them.
        <span className="mono dim" title="Yours: links Geneseed leaves alone">
          {i.drift.linked} linked
        </span>
      ) : (
        <span className="mono dim">none</span>
      )}
      {stale ? (
        <div className="mono dim ldg-sub">
          {stale} file{stale === 1 ? '' : 's'} behind
        </div>
      ) : null}
    </>
  )
}

// What differs from the source, in words, for the details row.
function differs(i) {
  if (!i.diffable) return 'Not checkable: drift is only checked for global installs.'
  const d = i.drift || {}
  const parts = [
    d.stale ? `${d.stale} behind` : null,
    d.edited ? `${d.edited} edited` : null,
    d.added ? `${d.added} added` : null,
    d.missing ? `${d.missing} missing` : null,
    d.linked ? `${d.linked} linked (yours)` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Nothing differs.'
}

function FleetRow({ i, n, onRebuild, onOpen, busy }) {
  const [open, setOpen] = useState(false)
  const label = labelOf(i)
  const where = (
    <td className="ldg-where">
      {/* The console's own sweep, while a rebuild job that names this row runs. */}
      {busy ? (
        <span className="console-progress" role="progressbar" aria-label={`Rebuilding ${label}`} />
      ) : null}
      <div className="ldg-who">
        {needsRebuild(i) ? (
          <svg
            className={`ldg-glyph ${driftTotal(i.drift) ? 'bad' : 'warn'}`}
            viewBox="0 0 10 10"
            role="img"
            aria-label={driftTotal(i.drift) ? 'edited by hand' : 'needs a rebuild'}
          >
            <path d="M5 1 9 9H1z" fill="currentColor" />
          </svg>
        ) : null}
        {i.state === 'active' && i.cost ? (
          <span className="ldg-phone-ring" aria-hidden="true">
            <CarrierRing cost={i.cost} i={n} />
          </span>
        ) : null}
        <div className="ldg-name">
          <span className="ldg-host">{i.host}</span> <span className="dim">{i.scope}</span>
          <div className="mono dim ldg-path">{i.path}</div>
        </div>
      </div>
    </td>
  )
  if (i.state !== 'active') {
    return (
      <tr className="ldg-off">
        {where}
        <td className="ldg-build">
          <span className="pill off">disabled</span>
        </td>
        <td className="ldg-sync" />
        <td className="ldg-root" />
        <td className="ldg-total" />
        <td className="ldg-act">
          <button
            type="button"
            className="btn ghost sm"
            aria-label={`Open ${label}`}
            onClick={() => onOpen(i)}
          >
            Open
          </button>
        </td>
      </tr>
    )
  }
  const sync = {
    synced: <span className="pill good">in step</span>,
    behind: <span className="pill warn">behind source</span>,
    unknown: <span className="pill off">not checked</span>,
  }[i.verdict]
  const total = costTotal(i.cost)
  // A zero or absent ceiling has no percentage; dividing by it printed "Infinity%" or "NaN%".
  const ceilPct = i.cost?.ceiling ? Math.round((i.cost.carrier / i.cost.ceiling) * 100) : null
  return (
    <>
      <tr className={open ? 'ldg-open' : ''}>
        {where}
        <td className="ldg-build">
          {sync}
          <div className="mono dim ldg-sub">
            {i.built_epoch ? `built ${relTime(i.built_epoch)} ago` : 'never built'}
          </div>
        </td>
        <td className="ldg-sync">
          <SyncCell i={i} />
        </td>
        <td className="ldg-root">
          {!i.cost ? (
            <span className="dim">not measured</span>
          ) : ceilPct === null ? (
            <span className="dim">no ceiling</span>
          ) : (
            <>
              <span className="ldg-rootbar">
                <Bar
                  value={tok(i.cost.carrier)}
                  max={tok(i.cost.ceiling)}
                  label={`Root file, ${label}`}
                  tone={ceilPct > 100 ? 'bad' : 'accent'}
                />
              </span>
              <span className="mono dim ldg-sub">
                {`${approxTokens(i.cost.carrier)} / ${approxTokens(i.cost.ceiling)} · ${ceilPct}%`}
              </span>
            </>
          )}
        </td>
        <td className="ldg-total">{i.cost ? <TokCount chars={total} /> : null}</td>
        <td className="ldg-act">
          {/* Rebuilds this row's install alone (the `rebuild` action), after a confirm. */}
          {needsRebuild(i) ? (
            <button
              type="button"
              className="btn ghost sm"
              aria-label={`Rebuild ${label}`}
              title={`Rebuilds ${label} only`}
              onClick={() => onRebuild([rebuildTarget(i)])}
            >
              Rebuild
            </button>
          ) : (
            <button
              type="button"
              className="btn ghost sm"
              aria-label={`Open ${label}`}
              onClick={() => onOpen(i)}
            >
              Open
            </button>
          )}
          <button
            type="button"
            className="btn ghost sm ldg-toggle"
            aria-label={`Details for ${label}`}
            aria-expanded={open}
            aria-controls={open ? `ldg-detail-${i.id}` : undefined}
            onClick={() => setOpen((o) => !o)}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
            </svg>
          </button>
        </td>
      </tr>
      {/* Rendered only while open (never hidden by CSS), so a collapsed row carries no text. */}
      {open ? (
        <tr className="ldg-detail" id={`ldg-detail-${i.id}`}>
          <td colSpan={COLS}>
            <div className="ldg-detail-grid">
              <div className="ldg-detail-col">
                {i.cost ? (
                  <>
                    <span className="ldg-lbl">{`What rides every turn · ${approxTokens(total)} tokens`}</span>
                    <StackBar parts={costParts(i.cost)} label={label} />
                  </>
                ) : (
                  <span className="dim">Always-on cost not measured.</span>
                )}
                <span className="dim">{`Voice ${i.theme} · ${i.footprint} footprint`}</span>
              </div>
              <div className="ldg-detail-col">
                <span className="ldg-lbl">Differs from source</span>
                <span className="muted">{differs(i)}</span>
                {i.diffable ? (
                  <span>
                    <a
                      className="btn ghost sm"
                      href="#/installs/edits"
                      aria-label={`View diff for ${label}`}
                    >
                      View diff
                    </a>
                  </span>
                ) : null}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}

function Needs({ rows, onAction, onRebuild }) {
  const problems = rows.filter((r) => !r.sugg).length
  return (
    <section className="panel" aria-labelledby="ldg-needs">
      <div className="panel-head panel-head-rule">
        <h2 id="ldg-needs">Needs you</h2>
        <span className="mono dim">
          {problems} problem{problems === 1 ? '' : 's'}, {rows.length - problems} suggestion
          {rows.length - problems === 1 ? '' : 's'}
        </span>
      </div>
      {rows.length ? (
        <ul className="needs">
          {rows.map((n) => (
            <li key={n.id} className={n.sugg ? 'sugg' : ''}>
              <span className={`tag ${n.tone}`}>{n.tag}</span>
              <span className="needs-what">
                <b>{n.title}</b>
                {n.detail ? <span className="dim"> · {n.detail}</span> : null}
              </span>
              <span className="mono dim needs-where">{n.where}</span>
              {n.act ? (
                <button
                  type="button"
                  className="needs-verb linkish"
                  aria-label={`${n.verb}: ${n.title}`}
                  onClick={() => (n.installs ? onRebuild(n.installs) : onAction(n.act))}
                >
                  {n.verb}
                </button>
              ) : (
                <a className="needs-verb" href={n.href} aria-label={`${n.verb}: ${n.title}`}>
                  {n.verb}
                </a>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="needs-empty">Nothing needs you.</p>
      )}
    </section>
  )
}

function WhatFires({ usage }) {
  const head = (
    <div className="panel-head">
      <h2 id="ldg-usage">What fires</h2>
      <span className="mono dim">skills and agents, 30 d</span>
    </div>
  )
  if (!usage) {
    return (
      <section className="panel" aria-labelledby="ldg-usage">
        {head}
        <p className="dim">Usage could not be read.</p>
      </section>
    )
  }
  if (!usage.enabled) {
    return (
      <section className="panel" aria-labelledby="ldg-usage">
        {head}
        <p className="dim">Usage counting is off on this machine.</p>
      </section>
    )
  }
  if (usage.days_counted < 30) {
    return (
      <section className="panel" aria-labelledby="ldg-usage">
        {head}
        <p className="muted">
          {usage.since ? (
            <>
              Counting since <b>{usage.since}</b>, {usage.days_counted} of 30 days
            </>
          ) : (
            'No skill or agent call counted yet'
          )}
        </p>
        <div className="daytrack" aria-hidden="true">
          {Array.from({ length: 30 }, (_, d) => (
            <i key={d} className={d < usage.days_counted ? 'on' : ''} />
          ))}
        </div>
        <p className="dim chart-foot">
          Rankings and the never-fired count appear once 30 days are counted, so a new install is
          not told every skill is unused.
        </p>
      </section>
    )
  }
  const top = usage.rows.slice(0, 7)
  const max = Math.max(1, ...top.map((r) => r.n))
  return (
    <section className="panel" aria-labelledby="ldg-usage">
      {head}
      <ul className="ubars">
        {top.map((r, j) => (
          <li key={`${r.install}:${r.kind}:${r.name}`} className={r.kind}>
            <span className="ub-name">
              {r.name} <span className="dim">{r.kind}</span>
            </span>
            <span className="ub-trk">
              <i style={{ width: pct(r.n, max), '--i': j }} />
            </span>
            <span className="mono">{r.n}</span>
          </li>
        ))}
      </ul>
      {usage.never.length ? (
        <div className="ub-never">
          <span>
            <b>{neverFired(usage).skills}</b> skills never fired
          </span>
          <a className="needs-verb" href="#/skills">
            Triage
          </a>
        </div>
      ) : null}
    </section>
  )
}

// `view` is the Overview's View control, handed down so both arms carry the same one.
export default function Ledger({
  overview,
  setup,
  runs,
  onAction,
  onRetry,
  dataRev,
  banner,
  view,
}) {
  const confirm = useConfirm()
  // job id → the row ids its rebuild names; a row shows the sweep while that run is running.
  const [rebuilding, setRebuilding] = useState({})
  // Not soft: a failed fleet read must be told apart from an empty one. useAsync keeps the
  // last good answer on a failed reload, so a blip shows the old table under an error line.
  const {
    data: fleet,
    error: fleetError,
    reload: reloadFleet,
  } = useAsync(() => api.fleet(), [dataRev])
  const { data: usage } = useAsync(() => soft(api.usage()), [dataRev])
  const { data: gates } = useAsync(() => soft(api.gates()), [dataRev])
  // A failed re-poll (the daemon restarting under it) keeps the last answer rather than hiding
  // the chip and the button until the next good one.
  const lastUpdate = useRef(null)
  const { data: update, reload: reloadUpdate } = useAsync(
    () =>
      soft(api.update()).then((u) => {
        if (u) lastUpdate.current = u
        return lastUpdate.current
      }),
    [dataRev],
  )
  useEffect(() => {
    const timer = setInterval(reloadUpdate, UPDATE_POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') reloadUpdate()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [reloadUpdate])
  const { data: rules } = useRules(dataRev)
  const { data: activity } = useAsync(() => soft(api.activity()), [dataRev])
  const { data: profile } = useAsync(() => soft(api.profile()), [dataRev])
  const { data: skills } = useAsync(() => soft(api.catalog('skills')), [dataRev], 'catalog:skills')
  const { data: laws } = useAsync(() => soft(api.catalog('laws')), [dataRev], 'catalog:laws')

  const installs = fleet?.installs || []
  const onOpen = async (i) => {
    try {
      await api.selectView(i.host, i.path)
    } catch {
      /* the selector snaps back on the next refetch */
    }
    onRetry?.()
    window.location.hash = '#/installs'
  }
  const needs = ledgerNeeds({
    fleet,
    usage,
    overview,
    setup,
    rules,
    activity,
    profile,
    skills,
    laws,
  })
  const behind = installs.filter(needsRebuild).map(rebuildTarget)
  const rebuild = async (targets) => {
    const names = targets.map((t) => t.label)
    const ok = await confirm(
      `Rebuild ${names.join(', ')}? Each is re-rendered from source with its own settings.`,
      {
        title:
          targets.length === 1 ? `Rebuild ${names[0]}?` : `Rebuild ${targets.length} installs?`,
        confirmLabel: 'Rebuild',
      },
    )
    if (!ok) return
    const jid = await onAction('rebuild', {
      installs: targets.map(({ host, path }) => ({ host, path })),
    })
    if (jid) setRebuilding((r) => ({ ...r, [jid]: targets.map((t) => t.id) }))
  }
  const running = new Set(
    Object.entries(rebuilding)
      .filter(([jid]) => runs?.find((r) => r.id === jid)?.status === 'running')
      .flatMap(([, ids]) => ids),
  )

  return (
    <>
      <PageHeader
        eyebrow={
          fleet
            ? `${installs.length} harness${installs.length === 1 ? '' : 'es'} installed on this machine`
            : null
        }
        title="Overview"
        actions={
          <>
            <VersionChip update={update} onAction={onAction} canFill={!behind.length} />
            {view}
          </>
        }
      />
      {banner}
      <div className="ov-stack ldg">
        <Health
          fleet={fleet}
          error={fleetError}
          behind={behind}
          onAction={onAction}
          onRebuild={rebuild}
        />
        <div className="ldg-kpis" role="group" aria-labelledby="ldg-kpis-h">
          <h2 id="ldg-kpis-h" className="sr-only">
            Key figures
          </h2>
          <RootKpi installs={installs} />
          <CostKpi installs={installs} />
          <CallsKpi usage={usage} />
          <GatesKpi gates={gates} laws={laws} />
        </div>
        <section className="panel" aria-labelledby="ldg-fleet">
          <div className="panel-head panel-head-rule">
            <h2 id="ldg-fleet">Installed harnesses</h2>
            {fleet?.source_fp ? <span className="mono dim">source {fleet.source_fp}</span> : null}
          </div>
          {fleetError && fleet ? (
            <p className="dim" role="status">
              Could not refresh the installs — showing the last read.{' '}
              <button type="button" className="btn ghost sm" onClick={reloadFleet}>
                Retry
              </button>
            </p>
          ) : null}
          <div className="ldg-scroll">
            <table className="ldg-fleet">
              <caption className="sr-only">Installs</caption>
              <thead>
                <tr>
                  <th scope="col">Install</th>
                  <th scope="col" className="ldg-build">
                    Build
                  </th>
                  <th scope="col" className="ldg-sync">
                    Sync with source
                  </th>
                  <th scope="col" className="ldg-root">
                    Root file · ceiling
                  </th>
                  <th scope="col" className="ldg-total">
                    Always-on
                  </th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {fleetError && !fleet ? (
                  <tr>
                    <td colSpan={COLS}>
                      <span className="dim" role="status">
                        Could not read the installs
                      </span>{' '}
                      <button type="button" className="btn ghost sm" onClick={reloadFleet}>
                        Retry
                      </button>
                    </td>
                  </tr>
                ) : null}
                {installs.map((i, n) => (
                  <FleetRow
                    key={i.id}
                    i={i}
                    n={n}
                    onRebuild={rebuild}
                    onOpen={onOpen}
                    busy={running.has(i.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <div className="ldg-bottom">
          <Needs rows={needs} onAction={onAction} onRebuild={rebuild} />
          <WhatFires usage={usage} />
        </div>
      </div>
    </>
  )
}
