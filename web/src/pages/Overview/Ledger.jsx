import React from 'react'
import { api } from '../../api/index.js'
import { useAsync } from '../../hooks/useAsync.js'
import { useRules } from '../../hooks/useRules.js'
import { driftTotal, relTime } from '../../lib/format.js'
import { CountUp, useCountUp } from '../../lib/motion.js'
import {
  COST_PARTS,
  approxTokens,
  costTotal,
  fleetVerdict,
  gateRows,
  ledgerNeeds,
} from '../../lib/overview.js'

// The Ledger: the Overview as a control panel over every INSTALLED harness on the machine.
// Verdict, then the fleet, then what needs you, then cost, usage and gates. Hosts with nothing
// installed are not listed; installing lives on the Installs page with its other settings.
// Every read degrades to null (a soft fetch), and a part that has no data says so in words.

const soft = (p) => p.catch(() => null)
const pct = (n, of) => `${of ? Math.min(100, (n / of) * 100) : 0}%`

function VersionChip({ update, onAction }) {
  if (!update) return null
  if (update.latest === null) {
    return (
      <span className="mono dim ver-chip">{update.current ?? ''} · update check unavailable</span>
    )
  }
  if (update.available) {
    return (
      <>
        <span className="mono ver-chip">
          {update.current} <span className="ver-new">{update.latest} available</span>
        </span>
        <button type="button" className="btn" onClick={() => onAction('update')}>
          Update
        </button>
      </>
    )
  }
  return <span className="mono dim ver-chip">{update.current} · latest</span>
}

function Verdict({ fleet }) {
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

function FleetRow({ i, n, onAction, onOpen }) {
  const where = (
    <td>
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
          <button type="button" className="btn ghost sm" onClick={() => onOpen(i)}>
            Open
          </button>
        </td>
      </tr>
    )
  }
  const drift = driftTotal(i.drift)
  const sync = {
    synced: <span className="pill good">in step</span>,
    behind: <span className="pill warn">behind source</span>,
    unknown: <span className="pill off">not checked</span>,
  }[i.verdict]
  const total = costTotal(i.cost)
  const ceilPct = i.cost && Math.round((i.cost.carrier / i.cost.ceiling) * 100)
  return (
    <tr>
      {where}
      <td>
        {i.theme} <span className="dim">· {i.footprint}</span>
      </td>
      <td>{sync}</td>
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
          <div className="ldg-cost" title={`root file ${ceilPct}% of the ${i.footprint} ceiling`}>
            <CarrierRing cost={i.cost} i={n} />
            <span>
              <TokCount chars={total} />
              <span className="dim ldg-sub">root file {ceilPct}% of ceiling</span>
            </span>
          </div>
        ) : (
          <span className="dim">not measured</span>
        )}
      </td>
      <td className="mono dim">{i.built_epoch ? `${relTime(i.built_epoch)} ago` : 'never'}</td>
      <td className="ldg-act">
        {i.verdict === 'behind' || drift ? (
          <button type="button" className="btn sm" onClick={() => onAction('build-all')}>
            Rebuild
          </button>
        ) : (
          <button type="button" className="btn ghost sm" onClick={() => onOpen(i)}>
            Open
          </button>
        )}
      </td>
    </tr>
  )
}

function Needs({ rows, onAction }) {
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
                  onClick={() => onAction(n.act)}
                >
                  {n.verb}
                </button>
              ) : (
                <a className="needs-verb" href={n.href}>
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
              {i.cost.ceiling ? (
                <span
                  className="cost-ceil"
                  style={{ left: pct(i.cost.ceiling, max) }}
                  title="root file ceiling"
                />
              ) : null}
            </div>
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
            <b>{usage.never.filter((x) => x.kind === 'skill').length}</b> skills never fired
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

export default function Ledger({ overview, setup, onAction, onRetry, dataRev, banner }) {
  const { data: fleet } = useAsync(() => soft(api.fleet()), [dataRev])
  const { data: usage } = useAsync(() => soft(api.usage()), [dataRev])
  const { data: gates } = useAsync(() => soft(api.gates()), [dataRev])
  const { data: update } = useAsync(() => soft(api.update()), [dataRev])
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

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="h">Overview</h1>
          <p className="sub mono">{fleet ? `${installs.length} installed · machine-wide` : ' '}</p>
        </div>
        <div className="page-actions">
          <VersionChip update={update} onAction={onAction} />
          <button type="button" className="btn ghost" onClick={() => onAction('doctor')}>
            Run doctor
          </button>
        </div>
      </div>
      {banner}
      <div className="ov-stack ldg">
        {fleet ? <Verdict fleet={fleet} /> : <div className="health" aria-busy="true" />}
        <section className="panel" aria-labelledby="ldg-fleet">
          <div className="panel-head panel-head-rule">
            <h2 id="ldg-fleet">Installs</h2>
            {fleet?.source_fp ? <span className="mono dim">source {fleet.source_fp}</span> : null}
          </div>
          <div className="ldg-scroll">
            <table className="ldg-fleet">
              <thead>
                <tr>
                  <th>Install</th>
                  <th>Voice</th>
                  <th>Sync</th>
                  <th>Hand edits</th>
                  <th>Always-on</th>
                  <th>Built</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {installs.map((i, n) => (
                  <FleetRow key={i.id} i={i} n={n} onAction={onAction} onOpen={onOpen} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <Needs rows={needs} onAction={onAction} />
        <div className="ov-charts">
          <CostChart installs={installs} />
          <UsageChart usage={usage} />
          <GatesChart gates={gates} laws={laws} />
        </div>
      </div>
    </>
  )
}
