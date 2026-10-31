import React, { useId, useRef, useState } from 'react'
import { api } from '../api/index.js'
import { Icon } from '../components/Icon.jsx'
import { relTime } from '../lib/format.js'
import {
  baseName,
  feedDays,
  hasCounters,
  needsYou,
  runDays,
  SessionHeader,
  shortDay,
  Spark,
  TodoStrip,
  useSweep,
} from '../lib/activity.jsx'
import { jobSummary } from '../lib/jobBuckets.js'
import { gateRows } from '../lib/overview.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'
import EmptyState from '../components/EmptyState.jsx'
import PageHeader from '../components/PageHeader.jsx'
import Seg from '../components/Seg.jsx'
import Garden from './Activity/Garden.jsx'
import { cardKey, detailHref, installNames, placeCards } from '../lib/garden.js'
import { useFlip } from '../lib/motion.js'
import { usePoll } from '../hooks/usePoll.js'
import { useAsync } from '../hooks/useAsync.js'

// A failed read degrades its own card to a line of text; it never blanks the page.
const soft = (p) => p.catch(() => null)

function SessionCard({ s }) {
  const id = useId()
  const todos = s.todos
  const counters = hasCounters(s)
  // A real <a>, not a div playing one: middle-click, open-in-new-tab and the
  // screen reader's links list all work, and nothing inside it is interactive. Its name
  // is the title and status alone; the counters describe it rather than name it.
  return (
    <a
      className="card pad-md act-card"
      href={s.href || detailHref(s.session_id)}
      aria-labelledby={`${id}-t ${id}-st`}
      aria-describedby={counters ? `${id}-c` : undefined}
    >
      <SessionHeader s={s} id={id} heading={s.title || baseName(s.cwd) || s.session_id}>
        {s.chip && (
          <span className="badge mono" title="The install this session runs in">
            {s.chip}
          </span>
        )}
        {/* affordance: this card opens the session detail (the card itself is the link) */}
        <Icon name="chevron" className="glyph act-chev" />
      </SessionHeader>

      {todos && todos.total > 0 && (
        <div className="act-foot">
          <span className="row gap-8 dim act-sm">
            <TodoStrip done={todos.done} total={todos.total} />
            plan {todos.done}/{todos.total}
          </span>
        </div>
      )}

      <div className="dim mono act-updated">updated {relTime(s.updated_at)} ago</div>
    </a>
  )
}

// AC-13: the one change a user who looked away needs to hear is a session starting to wait on
// them. Each poll compares the waiting sessions (by id AND status, so your move -> blocked
// speaks too) with the last poll's; the first poll only seeds, or every load would read out
// the sessions already waiting. Returns the sentence to announce, or ''.
const WAIT_SAYS = { blocked: 'is blocked', 'waiting-input': 'waits for your answer' }
function enteredNeedsYou(seen, sessions) {
  // A reply without a list says nothing about who waits: keep the last poll's view.
  if (!Array.isArray(sessions)) return ''
  const now = sessions.filter(needsYou)
  const before = seen.current
  seen.current = new Set(now.map((s) => `${cardKey(s)}:${s.status}`))
  if (!before) return ''
  return now
    .filter((s) => !before.has(`${cardKey(s)}:${s.status}`))
    .map((s) => `${s.title || baseName(s.cwd) || s.session_id} ${WAIT_SAYS[s.status]}`)
    .join('. ')
}

const FILTERS = [
  ['all', 'All'],
  ['needs', 'Needs you'],
  ['runs', 'Runs'],
  ['gates', 'Gate asks'],
]

// The filter lives in the hash (`#/activity?f=runs&v=list&host=x&project=y`, defaults
// omitted) so a reload or a shared link keeps it. Written with replaceState, which fires no
// hashchange: the router does not re-resolve and history gains no entry per chip click.
// `v` is the live sessions' view: the garden (default) or the list. An old link's `v=garden`
// still reads as the garden.
function readView() {
  const q = new URLSearchParams(window.location.hash.split('?')[1] || '')
  const f = q.get('f')
  return {
    f: FILTERS.some(([k]) => k === f) ? f : 'all',
    host: q.get('host') || '',
    project: q.get('project') || '',
    v: q.get('v') === 'list' ? 'list' : 'garden',
  }
}

function writeView(v) {
  const q = new URLSearchParams()
  if (v.f !== 'all') q.set('f', v.f)
  if (v.v === 'list') q.set('v', 'list')
  if (v.host) q.set('host', v.host)
  if (v.project) q.set('project', v.project)
  const s = q.toString()
  window.history.replaceState(null, '', `#/activity${s ? `?${s}` : ''}`)
}

// Tracking is per install (D1): one switch per active install, each named after the install it
// flips and nothing else. The heading says on while any install tracks.
function TrackingCard({ enabled, installs, onToggle }) {
  const names = installNames(installs)
  return (
    <section className="card pad-md act-track" aria-labelledby="act-track-h">
      <Icon name="activity" className="glyph act-fixed" />
      <div className="act-grow">
        <h2 id="act-track-h" className="act-track-title">
          {enabled ? 'Live sessions are on' : 'Live sessions are off'}
        </h2>
        {!enabled && (
          <p className="dim act-sm act-track-p">
            Runs and gate asks below come from the job log and the gate ledger. Turn tracking on to
            see what each session is doing now.
          </p>
        )}
      </div>
      <ul className="stack gap-8 act-fixed act-sm" aria-label="Tracking per install">
        {installs.length === 0 && <li className="dim">No active install to track.</li>}
        {installs.map((i, n) => (
          <li key={i.install} className="row gap-10">
            <span id={`act-track-l${n}`} title={i.path}>
              Track live sessions in <span className="mono">{names.get(i.install)}</span>
            </span>
            <div
              className={`sw-toggle${i.enabled ? ' on' : ''}`}
              role="switch"
              aria-checked={i.enabled}
              aria-labelledby={`act-track-l${n}`}
              tabIndex={0}
              onClick={() => onToggle(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  if (e.key === ' ') e.preventDefault()
                  onToggle(i)
                }
              }}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

// Fourteen UTC days of runs. A hatched column is a day older than the runs the log keeps:
// its zero cannot be told from a trimmed log, so it is never drawn as a zero.
function RunsCard({ jobs, loading }) {
  const cap = typeof jobs?.cap === 'number' ? jobs.cap : undefined
  const rows = runDays(jobs?.jobs, { days: 14, cap })
  const box = useSweep(rows.map((r) => (r.nodata ? '-' : r.n)).join(','), 'scaleY')
  const max = Math.max(1, ...rows.map((r) => r.n))
  const total = rows.reduce((s, r) => s + r.n, 0)
  const kept = rows.find((r) => !r.nodata)
  const hatched = rows.some((r) => r.nodata)
  const said = rows.filter((r) => r.n).map((r) => `${r.n} on ${shortDay(r.key)}`)
  const label =
    `Runs per day: ${said.join(', ') || 'none'}.` +
    (!hatched
      ? ''
      : kept
        ? ` Days before ${shortDay(kept.key)} are older than the runs the log keeps.`
        : ' No run is in the log yet.')
  return (
    <section className="card pad-md act-stat" aria-labelledby="act-runs-h">
      <div className="act-stat-head">
        <h2 id="act-runs-h" className="act-lbl">
          Runs per day · 14 days
        </h2>
        {jobs && <span className="act-big">{total}</span>}
      </div>
      {loading ? (
        <p className="dim act-sm">Reading the job log…</p>
      ) : !jobs ? (
        <p className="dim act-sm">The job log could not be read.</p>
      ) : (
        <>
          <div className="act-runs" role="img" aria-label={label} ref={box}>
            {rows.map((r) =>
              r.nodata ? (
                <i key={r.key} className="nodata" />
              ) : r.n ? (
                <i
                  key={r.key}
                  data-sweep
                  style={{ height: `${(r.n / max) * 100}%` }}
                  title={`${shortDay(r.key)}: ${r.n}`}
                />
              ) : (
                <i key={r.key} className="zero" />
              ),
            )}
          </div>
          <div className="mono act-axis" aria-hidden="true">
            <span>{shortDay(rows[0].key)}</span>
            <span>{shortDay(rows[7].key)}</span>
            <span>today</span>
          </div>
          {hatched && (
            <span className="dim act-xs">
              Hatched: older than the runs the log keeps{cap ? ` (last ${cap})` : ''}.
            </span>
          )}
        </>
      )}
    </section>
  )
}

function GatesCard({ rows, gates, loading }) {
  const total = rows.reduce((s, r) => s + r.n, 0)
  return (
    <section className="card pad-md act-stat" aria-labelledby="act-gates-h">
      <div className="act-stat-head">
        <h2 id="act-gates-h" className="act-lbl">
          Gate asks by rule · 30 days
        </h2>
        {gates && <span className="act-big">{total}</span>}
      </div>
      {loading ? (
        <p className="dim act-sm">Reading the gate ledger…</p>
      ) : rows.length ? (
        <ul className="gate-rows">
          {rows.slice(0, 6).map((r, j) => (
            <li key={r.rule}>
              <span className="act-ell">
                {r.name} <span className="mono dim act-xs">{r.rule}</span>
              </span>
              <Spark vals={r.per_day} i={j} sweep />
              <span className="mono">{r.n}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dim act-sm">
          {gates ? 'No gate asked in 30 days.' : 'The gate ledger could not be read.'}
        </p>
      )}
    </section>
  )
}

const PILL = { done: ['ok', 'done'], failed: ['bad', 'failed'], running: ['', 'running'] }

function RunRow({ job, longest }) {
  const s = jobSummary(job)
  const d = job.duration ? Math.round(job.duration * 10) / 10 : 0
  const [tone, word] = PILL[job.status] || ['', job.status || '…']
  const label =
    job.status === 'running'
      ? 'Still running'
      : d
        ? `Took ${d} second${d === 1 ? '' : 's'}`
        : 'No duration'
  const time = job.started
    ? new Date(job.started * 1000).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'
  return (
    <li className="act-row">
      <span className="mono dim act-xs">{time}</span>
      <Icon name="play" className="glyph act-glyph" />
      <span className="act-what">
        <span className="act-row-title">{s.verb}</span>
        {s.scope && (
          <span className="dim act-xs act-ell" title={s.command}>
            {s.scope}
          </span>
        )}
      </span>
      <span className="act-dur" role="img" aria-label={label}>
        <span
          data-sweep
          style={{ width: longest > 0 ? `${((job.duration || 0) / longest) * 100}%` : '0%' }}
        />
      </span>
      <span className={`badge ${tone}`}>{word}</span>
    </li>
  )
}

function GateRow({ gate }) {
  return (
    <li className="act-row gate">
      <span className="mono dim act-xs">—</span>
      <Icon name="rule" className="glyph act-glyph t-warn" />
      <span className="act-what">
        <span className="act-row-title">{gate.title}</span>
        <span className="dim act-xs">Gate ledger</span>
      </span>
      <span className="act-dur-none" aria-hidden="true" />
      <span className="badge warn">asked</span>
    </li>
  )
}

// The ended list folds past this many rows: it is history, and must not push the feed far down.
const ENDED_FOLD = 5

const uniq = (vals, current) => [...new Set([...vals.filter(Boolean), current].filter(Boolean))]

export default function Activity() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  // Read in the initializer, not an effect: the first paint already shows the right filter.
  const [view, setViewState] = useState(readView)
  const [allEnded, setAllEnded] = useState(false)
  // The live region's text, and the waiting sessions the last poll saw (null before the first).
  const [announce, setAnnounce] = useState('')
  const seen = useRef(null)
  const setView = (patch) => {
    const next = { ...view, ...patch }
    setViewState(next)
    writeView(next)
  }

  // 2s is plenty for a glanceable HUD; a failed poll is held (the next tick
  // recovers) so a momentary blip doesn't blank the view.
  usePoll(
    (alive) =>
      api.activity().then(
        (d) => {
          if (alive()) {
            setData(d)
            setError('')
            const said = enteredNeedsYou(seen, d?.activity)
            // An identical sentence would leave the text unchanged and unread: vary its tail.
            if (said) setAnnounce((was) => (was === said ? said + ' ' : said))
          }
        },
        (e) => {
          if (alive()) setError(e.message)
        },
      ),
    2000,
    [],
  )
  // Read once on mount: the job log and the gate ledger move per run or per ask, not per
  // second. No useAsync `key`: its module cache would hand one mount's log to the next.
  const jobsQ = useAsync(() => soft(api.jobs()), [])
  const gatesQ = useAsync(() => soft(api.gates()), [])
  const lawsQ = useAsync(() => soft(api.catalog('laws')), [])

  // Default on when the field is absent (older server / first paint).
  const enabled = data ? data.enabled !== false : true
  const installs = Array.isArray(data?.installs) ? data.installs : []
  // Sorted by id, ascending: the server buckets by status and recency, which reorders the
  // cards on every turn; an id never changes, so a card stays where the eye left it.
  // OpenCode ids descend with time, so ascending puts the newest first; Claude ids are
  // random, but still stable. The cards come from every install, each placed on its own
  // (`placeCards`: host chip, detail link), and keyed by session + checkout (`cardKey`), never
  // by install.
  const sessions = placeCards(data?.activity, installs).sort((a, b) =>
    a.session_id < b.session_id ? -1 : a.session_id > b.session_id ? 1 : 0,
  )
  const flipRef = useFlip()
  const waiting = enabled && data ? sessions.filter(needsYou).length : null
  // Already newest first and capped by the server, which also lets the live copy win a
  // duplicate; the key check is only a second guard, so one session never shows twice.
  const liveIds = new Set(sessions.map(cardKey))
  const endedAll = placeCards(data?.ended, installs).filter((s) => !liveIds.has(cardKey(s)))

  // Host and project options come only from values the data carries. Runs and gate asks
  // carry neither, so narrowing by one hides them and says so, rather than showing them as
  // if they matched.
  const hosts = uniq(
    [...sessions, ...endedAll].map((s) => s.host),
    view.host,
  )
  const projects = uniq(
    [...sessions, ...endedAll].map((s) => baseName(s.cwd)),
    view.project,
  )
  const narrowed =
    view.host && view.project
      ? 'host or project'
      : view.host
        ? 'host'
        : view.project
          ? 'project'
          : ''
  const matches = (s) =>
    (!view.host || s.host === view.host) && (!view.project || baseName(s.cwd) === view.project)
  const live = sessions.filter((s) => matches(s) && (view.f !== 'needs' || needsYou(s)))
  const showLive = view.f === 'all' || view.f === 'needs'
  // Nothing ended waits on you, so "Needs you" hides the section. Tracking off: the server
  // sends none, and `enabled` hides any the last poll left.
  const ended = view.f === 'all' && enabled ? endedAll.filter(matches) : []
  const endedShown = allEnded ? ended : ended.slice(0, ENDED_FOLD)
  const showRuns = !narrowed && (view.f === 'all' || view.f === 'runs')
  const showGates = !narrowed && (view.f === 'all' || view.f === 'gates')

  const jobs = jobsQ.data?.jobs || []
  const rules = gateRows(gatesQ.data, lawsQ.data)
  const groups = feedDays(jobs, rules, gatesQ.data?.days)
    .map((g) => ({ ...g, runs: showRuns ? g.runs : [], gate: showGates ? g.gate : null }))
    .filter((g) => g.runs.length || g.gate)
  const longest = Math.max(0, ...jobs.map((j) => j.duration || 0))
  const feedRef = useSweep(
    groups.flatMap((g) => g.runs.map((j) => `${j.id}:${j.duration}`)).join(','),
    'scaleX',
  )

  // Flips ONE install's tracking: the write names that install, and no other install moves.
  const toggle = async (row) => {
    const next = !row.enabled
    try {
      const res = await api.activityToggle(next, { host: row.host, path: row.path })
      if (res.ok === false) {
        setError(res.error || 'Could not change tracking')
        return
      }
      // Optimistic: reflect the flip on that install now; the next poll reconciles from disk.
      // A card another install also saw stays, shown from that install's copy.
      const keep = (list) =>
        res.enabled
          ? list || []
          : (list || []).flatMap((s) => {
              const left = (s.installs || [s.install]).filter((k) => k !== row.install)
              return left.length ? [{ ...s, install: left[0], installs: left }] : []
            })
      setData((d) => {
        const rows = (d?.installs || []).map((i) =>
          i.install === row.install ? { ...i, enabled: res.enabled } : i,
        )
        return {
          ...(d || {}),
          installs: rows,
          enabled: rows.length === 0 || rows.some((i) => i.enabled),
          activity: keep(d?.activity),
          ended: keep(d?.ended),
        }
      })
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }

  const select = (key, label, values) => (
    <span className="row gap-8 act-sm">
      <label htmlFor={`act-f-${key}`}>{label}</label>
      <select
        id={`act-f-${key}`}
        className="sel"
        value={view[key]}
        disabled={values.length === 0}
        title={values.length === 0 ? `No source carries a ${key} yet` : undefined}
        onChange={(e) => setView({ [key]: e.target.value })}
      >
        <option value="">All {key === 'host' ? 'hosts' : 'projects'}</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </span>
  )

  return (
    <div className="page-fill">
      <PageHeader
        title="Activity"
        sub="What your agents ran, what the gates asked, and which sessions are waiting on you."
      />
      {/* Mounted from the first render: a region that appears with its text is not read. */}
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
      {error && (
        <div className="act-gap">
          <ErrorState error={error} />
        </div>
      )}
      {data && <TrackingCard enabled={enabled} installs={installs} onToggle={toggle} />}

      <div className="act-today">
        <RunsCard jobs={jobsQ.data} loading={jobsQ.loading} />
        <GatesCard rows={rules} gates={gatesQ.data} loading={gatesQ.loading} />
        <section className="card pad-md act-stat" aria-labelledby="act-wait-h">
          <h2 id="act-wait-h" className="act-lbl">
            Waiting on you
          </h2>
          <span className="act-big act-wait">
            {waiting ?? '—'} <span className="dim act-sm">sessions</span>
          </span>
          <p className="dim act-sm">
            {enabled
              ? 'A session that waits on an approval or on your answer counts here.'
              : 'Turn tracking on to count the sessions that wait on you.'}
          </p>
        </section>
      </div>

      <div className="row wrap gap-8 act-filters">
        <div role="group" aria-label="Filter" className="row wrap gap-8">
          {FILTERS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={view.f === k ? 'chip-f on' : 'chip-f'}
              aria-pressed={view.f === k}
              onClick={() => setView({ f: k })}
            >
              {label}
              {k === 'needs' && waiting > 0 ? <span className="mono"> {waiting}</span> : null}
            </button>
          ))}
        </div>
        {select('host', 'Host', hosts)}
        {select('project', 'Project', projects)}
        <Seg aria-label="Live sessions view">
          {[
            ['list', 'List'],
            ['garden', 'Garden'],
          ].map(([k, l]) => (
            <button
              key={k}
              type="button"
              className={view.v === k ? 'on' : ''}
              aria-pressed={view.v === k}
              onClick={() => setView({ v: k })}
            >
              {l}
            </button>
          ))}
        </Seg>
      </div>
      {narrowed && view.f !== 'needs' && (
        <p className="dim act-sm">Runs and gate asks carry no {narrowed}; showing sessions only.</p>
      )}

      {showLive &&
        (!data ? (
          <Loading label="Reading live sessions…" />
        ) : !enabled && view.f !== 'needs' ? null : live.length === 0 ? (
          view.f === 'needs' ? (
            <EmptyState title="Nothing waits on you" />
          ) : (
            <EmptyState title="No active sessions">
              Run <code>opencode</code> and the sessions it spins up appear here.
            </EmptyState>
          )
        ) : view.v === 'garden' ? (
          <Garden sessions={live} collisions={data.collisions} />
        ) : (
          // A poll that adds or drops a session slides the list instead of re-dealing it.
          <div className="stack gap-12 act-live" ref={flipRef}>
            {live.map((s) => (
              <div key={cardKey(s)} data-flip={cardKey(s)}>
                <SessionCard s={s} />
              </div>
            ))}
          </div>
        ))}

      {ended.length > 0 && (
        // Same cards and list structure as the live list; `act-ended` and the dim "ended"
        // badge make it the quieter of the two.
        <section className="stack gap-12 act-live act-ended" aria-labelledby="act-ended-h">
          <h2 id="act-ended-h" className="act-lbl">
            Recently ended
          </h2>
          {endedShown.map((s) => (
            <div key={cardKey(s)}>
              <SessionCard s={s} />
            </div>
          ))}
          {ended.length > ENDED_FOLD && (
            <button
              type="button"
              className="btn ghost sm"
              aria-expanded={allEnded}
              onClick={() => setAllEnded((v) => !v)}
            >
              {allEnded ? 'Show fewer' : `Show all ${ended.length}`}
            </button>
          )}
        </section>
      )}

      {view.f !== 'needs' && (
        <section aria-label="Feed" className="stack gap-16 act-feed" ref={feedRef}>
          {groups.map((g) => (
            <section key={g.key} className="card act-day">
              <h3 className="act-day-h">
                <span>{g.title}</span>
                <span className="mono dim">{g.sum}</span>
              </h3>
              <ul className="act-rows">
                {g.runs.map((j) => (
                  <RunRow key={j.id} job={j} longest={longest} />
                ))}
                {g.gate && <GateRow gate={g.gate} />}
              </ul>
            </section>
          ))}
        </section>
      )}
    </div>
  )
}
