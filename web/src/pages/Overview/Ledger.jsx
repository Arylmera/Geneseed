import React, { useEffect, useRef, useState } from 'react'
import { api } from '../../api/index.js'
import { useAsync } from '../../hooks/useAsync.js'
import { useConfirm } from '../../hooks/useConfirm.jsx'
import { useRules } from '../../hooks/useRules.js'
import { driftTotal, relTime } from '../../lib/format.js'
import PageHeader from '../../components/PageHeader.jsx'
import { CountUp, useCountUp } from '../../lib/motion.js'
import {
  COST_PARTS,
  approxTokens,
  costTotal,
  fleetVerdict,
  gateRows,
  ledgerNeeds,
  needsRebuild,
  neverFired,
  rebuildTarget,
} from '../../lib/overview.js'

// The Ledger: the Overview as a control panel over every INSTALLED harness on the machine.
// Verdict, then the fleet, then what needs you, then cost, usage and gates. Hosts with nothing
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

function Verdict({ fleet, error }) {
  if (!fleet) {
    // A failed read is not a load in progress: no aria-busy, and no claim either way.
    return error ? (
      <div className="health" role="status">
        <span className="health-dot" aria-hidden="true" />
        <p className="verdict-facts">
          <b>Status unknown</b>
        </p>
      </div>
    ) : (
      <div className="health" aria-busy="true" />
    )
  }
  const v = fleetVerdict(fleet)
  return (
    <div className={`health ${v.tone}`} role="status">
      <span className="health-dot" aria-hidden="true" />
      <p className="verdict-facts">
        <b>{v.head}</b>
        {v.facts.map((f) => (
          <span key={f} className="muted">
            {f}
          </span>
        ))}
      </p>
    </div>
  )
}

// The always-on figure travelling up to its value; CountUp rounds to an integer, and this
// figure is a one-decimal thousand.
function TokCount({ chars }) {
  const n = useCountUp(chars)
  return <span className="mono">{approxTokens(n ?? chars)} tok</span>
}

// The carrier against its ceiling, as a ring: the one part of the cost a gate bounds.
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

function FleetRow({ i, n, onRebuild, onOpen, busy }) {
  const label = `${i.host} · ${i.scope}`
  const where = (
    <td className="ldg-where">
      {/* The console's own sweep, while a rebuild job that names this row runs. */}
      {busy ? (
        <span className="console-progress" role="progressbar" aria-label={`Rebuilding ${label}`} />
      ) : null}
      <span className="ldg-host">{i.host}</span> <span className="dim">{i.scope}</span>
      <div className="mono dim ldg-path">{i.path}</div>
    </td>
  )
  if (i.state !== 'active') {
    return (
      <tr className="ldg-off">
        {where}
        <td>
          {i.theme} <span className="dim">· {i.footprint}</span>
        </td>
        <td>
          <span className="pill off">disabled</span>
        </td>
        <td />
        <td />
        <td />
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
  const drift = driftTotal(i.drift)
  // Unedited files the source has moved past: part of being behind, never a hand edit.
  const stale = i.drift?.stale ?? 0
  const sync = {
    synced: <span className="pill good">in step</span>,
    behind: <span className="pill warn">behind source</span>,
    unknown: <span className="pill off">not checked</span>,
  }[i.verdict]
  const total = costTotal(i.cost)
  // A zero or absent ceiling has no percentage; dividing by it printed "Infinity%" or "NaN%".
  const ceilPct = i.cost?.ceiling ? Math.round((i.cost.carrier / i.cost.ceiling) * 100) : null
  const ceilText = ceilPct === null ? 'no ceiling' : `root file ${ceilPct}% of ceiling`
  return (
    <tr>
      {where}
      <td>
        {i.theme} <span className="dim">· {i.footprint}</span>
      </td>
      <td>
        {sync}
        {stale ? (
          <div className="mono dim ldg-sub">
            {stale} file{stale === 1 ? '' : 's'} behind
          </div>
        ) : null}
      </td>
      <td>
        {!i.diffable ? (
          <span className="dim" title="Drift is only checked for global installs">
            not checkable
          </span>
        ) : drift ? (
          <span className="mono t-warn">{drift} edited</span>
        ) : i.drift?.linked ? (
          // The user's own links: shown, so their absence from the count is explained, but
          // muted and with no Rebuild, because no rebuild clears them.
          <span className="mono dim" title="Yours: links Geneseed leaves alone">
            {i.drift.linked} linked
          </span>
        ) : (
          <span className="mono dim">none</span>
        )}
      </td>
      <td>
        {i.cost ? (
          <div
            className="ldg-cost"
            title={
              ceilPct === null
                ? 'no ceiling'
                : `root file ${ceilPct}% of the ${i.footprint} ceiling`
            }
          >
            <CarrierRing cost={i.cost} i={n} />
            <span>
              <TokCount chars={total} />
              <span className="dim ldg-sub">{ceilText}</span>
            </span>
          </div>
        ) : (
          <span className="dim">not measured</span>
        )}
      </td>
      <td className="mono dim">{i.built_epoch ? `${relTime(i.built_epoch)} ago` : 'never'}</td>
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
      </td>
    </tr>
  )
}

function Needs({ rows, onAction, onRebuild }) {
  const problems = rows.filter((r) => !r.sugg).length
  return (
    <section className="panel" aria-labelledby="ldg-needs">
      <div className="panel-head panel-head-rule">
        <h2 id="ldg-needs">Needs attention</h2>
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

function CostChart({ installs }) {
  const act = installs.filter((i) => i.state === 'active' && i.cost)
  const max = Math.max(1, ...act.map((i) => Math.max(costTotal(i.cost), i.cost.ceiling || 0)))
  return (
    <section className="panel chart-card" aria-labelledby="ldg-cost">
      <div className="panel-head">
        <h2 id="ldg-cost">Always-on cost</h2>
        <span className="mono dim">≈ tokens per session</span>
      </div>
      {act.length ? (
        act.map((i, n) => (
          <div className="cost-row" key={i.id}>
            <div className="cost-lab">
              <span>
                {i.host} <span className="dim">{i.scope}</span>
              </span>
              <span className="mono">{approxTokens(costTotal(i.cost))}</span>
            </div>
            <div className="cost-stack">
              <span className="cost-segs" style={{ '--i': n }}>
                {COST_PARTS.map(([k]) => (
                  <span key={k} className={`cs-${k}`} style={{ width: pct(i.cost[k], max) }} />
                ))}
              </span>
            </div>
            {/* The ceiling bounds the root file alone, so it is drawn against the root file
                alone: on the total stack it read as a cap on the whole session cost. */}
            {i.cost.ceiling ? (
              <div
                className="cost-stack cost-lane"
                title={`root file ${Math.round((i.cost.carrier / i.cost.ceiling) * 100)}% of ceiling`}
              >
                <span className="cost-segs" style={{ '--i': n }}>
                  <span className="cs-carrier" style={{ width: pct(i.cost.carrier, max) }} />
                </span>
                <span className="cost-ceil" style={{ left: pct(i.cost.ceiling, max) }} />
              </div>
            ) : null}
          </div>
        ))
      ) : (
        <p className="dim">No install has a root file to measure.</p>
      )}
      <div className="cost-key">
        {COST_PARTS.map(([k, l]) => (
          <span key={k}>
            <i className={`cs-${k}`} />
            {l}
          </span>
        ))}
        <span>
          <i className="cost-ceil-key" />
          root file ceiling
        </span>
      </div>
      <p className="dim chart-foot">Estimated as characters ÷ 4 from the emitted files.</p>
    </section>
  )
}

function UsageChart({ usage }) {
  const head = (
    <div className="panel-head">
      <h2 id="ldg-usage">What fires</h2>
      <span className="mono dim">skills and agents, 30 d</span>
    </div>
  )
  if (!usage) {
    return (
      <section className="panel chart-card" aria-labelledby="ldg-usage">
        {head}
        <p className="dim">Usage could not be read.</p>
      </section>
    )
  }
  if (!usage.enabled) {
    return (
      <section className="panel chart-card" aria-labelledby="ldg-usage">
        {head}
        <p className="dim">Usage counting is off on this machine.</p>
      </section>
    )
  }
  if (usage.days_counted < 30) {
    return (
      <section className="panel chart-card" aria-labelledby="ldg-usage">
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
  const dmax = Math.max(1, ...usage.per_day)
  const sum = usage.per_day.reduce((a, b) => a + b, 0)
  return (
    <section className="panel chart-card" aria-labelledby="ldg-usage">
      {head}
      <div className="cols30-wrap">
        <div className="chart-axis mono dim">
          <span>calls per day</span>
          <span>
            <CountUp value={sum} /> in 30 d
          </span>
        </div>
        <div className="cols30" aria-hidden="true">
          {usage.per_day.map((v, d) => (
            <i
              key={d}
              className={d === 29 ? 'today' : ''}
              style={{ height: pct(v, dmax), '--i': d }}
            />
          ))}
        </div>
      </div>
      <ul className="ubars">
        {top.map((r, j) => (
          <li key={`${r.install}:${r.kind}:${r.name}`} className={r.kind}>
            <span className="ub-name">{r.name}</span>
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

function Spark({ vals, i }) {
  const w = 96
  const h = 22
  const max = Math.max(1, ...vals)
  const step = w / (vals.length - 1)
  const pts = vals.map(
    (v, d) => `${(d * step).toFixed(1)},${(h - 2 - (v / max) * (h - 5)).toFixed(1)}`,
  )
  const [lx, ly] = pts[pts.length - 1].split(',')
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ '--i': i }}>
      <polyline points={`0,${h - 1} ${w},${h - 1}`} className="spk-base" />
      <polygon className="spk-area" points={`0,${h - 1} ${pts.join(' ')} ${w},${h - 1}`} />
      <polyline className="spk-line" pathLength="1" points={pts.join(' ')} />
      <circle className="spk-end" cx={lx} cy={ly} r="2.4" />
    </svg>
  )
}

function GatesChart({ gates, laws }) {
  const rows = gateRows(gates, laws)
  return (
    <section className="panel chart-card" aria-labelledby="ldg-gates">
      <div className="panel-head">
        <h2 id="ldg-gates">Gates</h2>
        <span className="mono dim">asks per rule, 30 d</span>
      </div>
      {rows.length ? (
        <ul className="gate-rows">
          {rows.slice(0, 6).map((r, j) => (
            <li key={r.rule}>
              <span>{r.name}</span>
              <Spark vals={r.per_day} i={j} />
              <span className="mono">{r.n}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dim">
          {gates ? 'No gate asked in 30 days.' : 'Gate activity could not be read.'}
        </p>
      )}
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
  // One primary per page: a rebuild that is due outranks an update that is due. It rebuilds
  // only the N installs that need it, each named in the confirm.
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
        title="Overview"
        sub={
          <span className="mono">
            {fleet ? `${installs.length} installed · machine-wide` : ' '}
          </span>
        }
        primary={
          behind.length ? (
            <button
              type="button"
              className="btn"
              title={`Rebuilds ${behind.map((t) => t.label).join(', ')}`}
              onClick={() => rebuild(behind)}
            >
              Rebuild all behind ({behind.length})
            </button>
          ) : null
        }
        actions={
          <>
            <VersionChip update={update} onAction={onAction} canFill={!behind.length} />
            <button type="button" className="btn ghost" onClick={() => onAction('doctor')}>
              Run doctor
            </button>
            {view}
          </>
        }
      />
      {banner}
      <div className="ov-stack ldg">
        <Verdict fleet={fleet} error={fleetError} />
        <section className="panel" aria-labelledby="ldg-fleet">
          <div className="panel-head panel-head-rule">
            <h2 id="ldg-fleet">Installs</h2>
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
                  <th scope="col">Voice</th>
                  <th scope="col">Sync</th>
                  <th scope="col">Hand edits</th>
                  <th scope="col">Always-on</th>
                  <th scope="col">Built</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {fleetError && !fleet ? (
                  <tr>
                    <td colSpan={7}>
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
        <Needs rows={needs} onAction={onAction} onRebuild={rebuild} />
        <div className="ov-charts">
          <CostChart installs={installs} />
          <UsageChart usage={usage} />
          <GatesChart gates={gates} laws={laws} />
        </div>
      </div>
    </>
  )
}
