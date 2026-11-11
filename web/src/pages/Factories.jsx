import React, { useState } from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'
import { usePoll } from '../hooks/usePoll.js'
import ErrorState from '../components/ErrorState.jsx'
import EmptyState from '../components/EmptyState.jsx'
import CopyButton from '../components/CopyButton.jsx'
import DataTable from '../components/DataTable.jsx'
import Loading from '../components/Loading.jsx'
import FactoryGraph from '../components/FactoryGraph.jsx'
import { GroupedRows, LibList, filterRows } from '../components/LibRows.jsx'
import RailCats, { groupsOf } from '../components/RailCats.jsx'
import { TONE } from '../components/ActiveLoops.jsx'
import { TABS, TAB_LABELS } from '../lib/router.js'
import InstallPicker from '../components/InstallPicker.jsx'
import { useInstallPick, useInstalls } from '../hooks/useInstalls.js'
import { installTag, pairOf } from '../lib/hosts.js'

const enc = encodeURIComponent
const POLL_MS = 5000

// The rail's sections, in order: the router's `#/factories/<id>` tabs, under their tab labels.
const SECTIONS = TABS.factories.map((k) => [k, TAB_LABELS[k]])
const ORIGIN = { project: 'Project', global: 'Global', shipped: 'Shipped' }
const RAIL_LABEL = { templates: 'Origins', active: 'Statuses' }
// The board's columns, by what a run needs from you, the ones that wait first. A FACTORY.md
// that cannot be read stops every engine action until someone repairs it, so it waits for you
// too. `done` is a closed run whose FACTORY.md is still there; `finished` one whose file is gone.
// Inside a column, runs keep the order of its statuses: a stopped run before a closed one.
export const COLUMNS = [
  ['wait', 'Waits for you', ['awaiting', 'unreadable']],
  ['run', 'Running', ['running']],
  ['end', 'Ended', ['stopped', 'done', 'finished']],
]
const STATUS = COLUMNS.flatMap(([, label, statuses]) => statuses.map((s) => [s, label]))
// A live row carries FACTORY.md's state; a finished or unreadable one only its identity.
const live = (r) => !!r.graph

const grouped = (items, keyOf, order) =>
  order.flatMap(([k, label]) =>
    items.filter((it) => keyOf(it) === k).map((it) => ({ ...it, group: label })),
  )
export const factoryRows = (factories) =>
  grouped(
    factories.map((f) => ({ ...f, desc: f.description })),
    (f) => f.origin,
    Object.entries(ORIGIN),
  )
export const runRows = (runs) =>
  grouped(
    runs.map((r) => ({ ...r, name: r.root, desc: r.factory })),
    (r) => r.status,
    STATUS,
  )

// A duration as the board prints it. `null` is a time nobody recorded: `unknown`, never 0.
export function fmtMs(ms) {
  if (ms == null) return 'unknown'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}
// An engine time (ISO, UTC) to the minute, as written: no locale, so every viewer reads the same.
const clock = (at) => `${at.slice(0, 16).replace('T', ' ')} UTC`

// What a card says under the run's title: where it stands, its task, the laps it has spent
// against each cycle's max, and its work and waiting time (`runMetrics`, computed by the engine).
export function cardFacts(r) {
  if (r.status === 'unreadable') return ['Its FACTORY.md cannot be read.']
  if (r.status === 'finished') return ['Its FACTORY.md is gone: the run closed.']
  const t = r.tasks
  const laps = (r.graph?.cycles || [])
    .filter((c) => r.counters?.[c.name])
    .map((c) => `${c.name} ${r.counters[c.name]} / ${c.max}`)
  const where = r.awaiting
    ? `Waits at ${r.awaiting.stage} (${r.awaiting.outcome})`
    : r.status === 'stopped'
      ? `Stopped: ${r.reason}`
      : r.status === 'done'
        ? 'Closed'
        : `At ${r.stage}`
  return [
    where,
    t ? `task ${t.index} / ${t.count}` : null,
    laps.length ? `laps: ${laps.join(', ')}` : null,
    r.metrics ? `work ${fmtMs(r.metrics.workMs)} · waited ${fmtMs(r.metrics.waitMs)}` : null,
  ].filter(Boolean)
}

// Factories › Active with no run selected: every run as a card, in three columns. A card opens
// the run's detail. Read-only, as the whole page is: a gate is answered in the agent's session.
function RunBoard({ runs }) {
  return (
    <section className="fac-board" aria-label="Runs board">
      {COLUMNS.map(([key, label, statuses]) => {
        const col = runs.filter((r) => statuses.includes(r.status))
        return (
          <div key={key} className={`fac-col ${key}`} role="group" aria-label={label}>
            <h3 className="loop-kicker">
              {label} <span className="mono dim">{col.length}</span>
            </h3>
            {col.length ? (
              <ul>
                {col.map((r) => (
                  <li key={r.root}>
                    <a className="fac-card" href={`#/factories/active/${enc(r.root)}`}>
                      <b>{r.title}</b>
                      <span className="mono">{r.factory}</span>
                      {cardFacts(r).map((f) => (
                        <span key={f}>{f}</span>
                      ))}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="panel-note">None.</p>
            )}
          </div>
        )
      })}
    </section>
  )
}

// A run's history, one row per entry: a stage's outcome or the user's answer at a gate, when it
// was recorded, how long it took (work time, or waiting time on an answer) and a rework mark.
// Durations and marks are the engine's (`metrics.entries`, parallel to `history`).
function Timeline({ run }) {
  if (!run.history?.length) return null
  const m = run.metrics
  const rows = run.history.map((h, i) => ({ i, h, e: m?.entries?.[i] || {} }))
  return (
    <>
      <h3 className="loop-h2">Timeline</h3>
      <DataTable
        caption="Run history"
        captionHidden
        rowKey={(r) => r.i}
        rows={rows}
        columns={[
          { key: 'stage', label: 'Stage', render: (r) => r.h.stage },
          {
            key: 'result',
            label: 'Result',
            render: (r) =>
              r.h.verdict ? (
                `you answered ${r.h.verdict}`
              ) : (
                <>
                  {r.h.outcome} {r.e.rework ? <span className="tag warn">rework</span> : null}
                </>
              ),
          },
          {
            key: 'at',
            label: 'Time',
            // a hand-edited FACTORY.md may hold any value here: only a string is a time
            render: (r) =>
              typeof r.h.at === 'string' ? (
                <time dateTime={r.h.at}>{clock(r.h.at)}</time>
              ) : (
                'unknown'
              ),
          },
          {
            key: 'ms',
            label: 'Duration',
            render: (r) => `${fmtMs(r.e.ms)}${r.e.wait ? ' waiting' : ''}`,
          },
        ]}
      />
      {m ? (
        <p className="panel-note fac-totals">
          Work {fmtMs(m.workMs)} · waited {fmtMs(m.waitMs)} · tokens {m.tokens ?? 'unknown'}
        </p>
      ) : null}
    </>
  )
}

const tag = (cls, text) => (
  <span key={text} className={`tag${cls ? ` ${cls}` : ''}`}>
    {text}
  </span>
)
const PILLS = {
  templates: (f) => tag('', f.origin),
  active: (r) => tag(TONE[r.status], r.status),
}

// The factory's graph: it measures its own box and fits it, never scrolling sideways (D18).
const Graph = FactoryGraph

// Each declared cycle in words: its stages, and its laps (a run's `counters`) against `max`.
function Cycles({ factory, counters }) {
  if (!factory.cycles?.length) return null
  return (
    <>
      <h3 className="loop-h2">Routes back</h3>
      <ul className="fac-cycles" aria-label="Cycles">
        {factory.cycles.map((c) => (
          <li key={c.name}>
            <b>{c.name}</b>: {c.nodes.join(' → ')} —{' '}
            {counters ? `lap ${counters[c.name] ?? 0} of ${c.max}` : `${c.max} laps at most`}
          </li>
        ))}
      </ul>
    </>
  )
}

function FactoryDetail({ f, bricks, loops }) {
  const ask = `Run the ${f.name} factory on <issue URL, file or request>`
  // The factory skill's Setup by hand, as one `&&` chain: pasted with its placeholders unfilled,
  // the first command fails and `init` never runs in this checkout, on its current branch.
  const cmd = [
    'git worktree add ../<repo>-factory-<slug> -b loop/factory-<slug>',
    'cd ../<repo>-factory-<slug>',
    `geneseed factory init --factory ${f.name} --title "<title>" --requirement "<requirement>" --input "<issue URL, file path or pasted text>"`,
  ].join(' && ')
  return (
    <>
      <div className="reader-tags">
        <span className="tag acc">Factory</span>
        {tag('', f.origin)}
      </div>
      <h2 className="reader-title">{f.name}</h2>
      {f.description ? <p className="reader-lede">{f.description}</p> : null}
      <p className="mono dim reader-src">
        factories/{f.name}.json · {f.origin}
      </p>
      <hr className="hr" />
      <Graph factory={f.factory} bricks={bricks} loops={loops} />
      <Cycles factory={f.factory} />
      <section className="loop-start" aria-labelledby="fac-start-h">
        <div className="loop-start-bar">
          <h3 id="fac-start-h" className="loop-kicker">
            Start it: ask the agent
          </h3>
          <CopyButton text={ask} label="Copy request" />
        </div>
        <pre className="mono">{ask}</pre>
        <div className="loop-start-bar">
          <h3 className="loop-kicker">Or by hand, in a new worktree</h3>
          <CopyButton text={cmd} label="Copy command" />
        </div>
        <pre className="mono">{cmd}</pre>
      </section>
      <p className="panel-note">
        <code className="mono">init</code> only registers the run: an agent then drives{' '}
        <code className="mono">geneseed factory next</code> and <code className="mono">record</code>
        .
      </p>
      {f.factory.rules?.length ? (
        <>
          <h3 className="loop-h2">Rules</h3>
          <ul className="loop-rules" aria-label="Rules every stage follows">
            {f.factory.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  )
}

// A run carries its own graph but no bricks or loops: those (a brick's human gate, its outcomes,
// a loop's box) come from the catalogue of `from`, the Templates tab's install, which the run's
// project may not share. The registry names no install per run, so the reader says so.
function RunDetail({ run, bricks, loops, from }) {
  const t = run.tasks
  return (
    <>
      <p className="panel-note">
        <a href="#/factories/active">← All runs</a>
      </p>
      <div className="reader-tags">
        <span className="tag acc">Factory run</span>
        <span className={`tag${TONE[run.status] ? ` ${TONE[run.status]}` : ''}`}>{run.status}</span>
      </div>
      <h2 className="reader-title">{run.title}</h2>
      <p className="mono dim reader-src">
        {run.factory} · {run.branch} · {run.root}
      </p>
      {live(run) ? (
        <>
          <p className="reader-lede">
            At {run.stage} · {run.transitions} transitions
            {t ? ` · task ${t.index} / ${t.count}` : ''}
            {run.loop ? ` · loop at ${run.loop.node}, iteration ${run.loop.iteration}` : ''}
          </p>
          {run.awaiting ? (
            <p className="loop-run-wait t-warn">
              <b>
                Awaiting {run.awaiting.kind ?? 'you'}
                {run.awaiting.stage ? ` at ${run.awaiting.stage} (${run.awaiting.outcome})` : ''}
              </b>{' '}
              — Answer in the agent&apos;s session.
              {run.awaiting.note ? (
                <>
                  {' '}
                  Its note: <code className="mono">{run.awaiting.note}</code>
                </>
              ) : null}
            </p>
          ) : null}
          {run.reason ? <p className="panel-note">{run.reason}</p> : null}
          <hr className="hr" />
          <Graph
            factory={run.graph}
            bricks={bricks}
            loops={loops}
            highlight={run.stage}
            child={run.loop}
            counters={run.counters}
            lane={run.lane}
            history={run.history}
          />
          <Cycles factory={run.graph} counters={run.counters} />
          <Timeline run={run} />
          <p className="panel-note">
            Bricks and loops drawn from the catalogue of {from || 'the default install'}, which the
            run’s project may not share.
          </p>
        </>
      ) : (
        <p className="reader-lede">
          {run.status === 'unreadable'
            ? 'Its FACTORY.md cannot be read, so there is no state to show.'
            : 'Its FACTORY.md is gone: the run closed and its state went with it.'}
        </p>
      )}
    </>
  )
}

function Problems({ problems }) {
  if (!problems?.length) return null
  const n = problems.length
  return (
    <div className="panel loop-problems" role="status" aria-label="Catalogue files skipped">
      <b className="t-warn">
        {n} factory {n === 1 ? 'problem' : 'problems'}: these factories cannot run as they are
      </b>
      <ul className="panel-note">
        {problems.map((p) => (
          <li key={p} className="mono">
            {p}
          </li>
        ))}
      </ul>
    </div>
  )
}

const EMPTY = {
  templates: {
    title: 'No factories',
    body: (
      <>
        Add one under <code className="mono">.geneseed/factories/</code> in the repo.
      </>
    ),
  },
  active: {
    title: 'No runs yet',
    body: (
      <>
        Ask the agent to run a factory, or start one by hand in a worktree with{' '}
        <code className="mono">geneseed factory init</code>. It shows up here while it runs.
      </>
    ),
  },
}
const LEDE = {
  templates: (
    <>
      A factory carries one work item through bricks and loops to an open PR.{' '}
      <a href="#/docs/factories">How factories work →</a>
    </>
  ),
  active: (
    <>
      Factory runs registered on this machine, read from their FACTORY.md: the ones that wait for
      you first. A card opens its timeline. <a href="#/docs/run-a-factory">Run a factory →</a>
    </>
  ),
}

// Every run `geneseed factory init` registered, polled (the rail counts them on both tabs).
function useActiveFactories() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  usePoll(
    (alive) =>
      api.activeFactories().then(
        (d) => alive() && (setData(d), setError(null)),
        (e) => alive() && setError(e.message),
      ),
    POLL_MS,
    [],
  )
  return { runs: data ? data.factories || [] : null, error }
}

// The Factories page, in the Loops page's three panes: a rail of sections (Templates, Active),
// the section's list, and the selected entry drawn as its graph. Templates are one install's
// files (read-only); Active is the machine's runs, polled, and borrows the catalogue's bricks and
// loop graphs to draw them. Routing: `#/factories/<section>/<item>` (a run's item is its root).
export default function Factories({ tab = 'templates', item, dataRev }) {
  const active = useInstalls(dataRev)
  const [install, pickInstall] = useInstallPick('factories', active)
  const { data, error } = useAsync(
    () => api.factories(pairOf(install)),
    [dataRev, install?.id ?? ''],
    'factories',
  )
  const { runs, error: runError } = useActiveFactories()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [seenTab, setSeenTab] = useState(tab)
  if (tab !== seenTab) {
    setSeenTab(tab)
    setQ('')
    setCat('all')
  }

  const bricks = data?.bricks || []
  const loops = data?.loops || []
  const all = tab === 'active' ? runs && runRows(runs) : data && factoryRows(data.factories || [])
  const rows = all || []
  const cats = groupsOf(rows)
  const pool = cat === 'all' ? rows : rows.filter((r) => r.group === cat)
  const ql = q.trim()
  const shown = filterRows(pool, ql)
  const gone = !!(item && all && !rows.some((r) => r.name === item))
  // Active with no run named is the board; a template always has one selected.
  const sel = gone
    ? null
    : rows.find((r) => r.name === item) || (tab === 'active' ? null : rows[0]) || null
  const counts = { templates: data?.factories?.length, active: runs?.length }
  const label = SECTIONS.find(([k]) => k === tab)[1]
  const err = tab === 'active' ? runError : error

  return (
    <div className="lib-wrap">
      {tab === 'active' ? null : (
        <InstallPicker
          className="page-pick"
          installs={active}
          value={install}
          onChange={pickInstall}
        />
      )}
      <ErrorState error={err} style={{ margin: '0 0 var(--sp-3)' }} />
      <Problems problems={data?.problems} />
      <div className="library">
        <aside className="lib-kinds" aria-label="Factories sections">
          <div className="lib-title">
            <h1 className="h">Factories</h1>
            <span className="dim">Work items, carried to a PR</span>
          </div>
          <p className="panel-note lib-lede">{LEDE[tab]}</p>
          <nav className="kind-list" aria-label="Sections">
            {SECTIONS.map(([k, l]) => (
              <React.Fragment key={k}>
                <a
                  href={`#/factories/${k}`}
                  className={tab === k ? 'on' : ''}
                  aria-current={tab === k ? 'page' : undefined}
                >
                  {l}
                  <span className="mono dim">{counts[k] ?? ''}</span>
                </a>
                {tab === k && (
                  <RailCats
                    label={RAIL_LABEL[k]}
                    total={rows.length}
                    cats={cats}
                    cat={cat}
                    onChange={setCat}
                  />
                )}
              </React.Fragment>
            ))}
          </nav>
        </aside>

        <LibList
          label={label}
          count={ql ? `${shown.length} of ${pool.length}` : all ? pool.length : ''}
          q={q}
          onQ={setQ}
          matched={shown.length}
          inView={[tab, item]}
          current={sel?.name}
          sections={SECTIONS.map(([k, l]) => ({
            key: k,
            label: l,
            n: counts[k],
            href: `#/factories/${k}`,
            on: tab === k,
          }))}
          cats={cats}
          cat={cat}
          total={rows.length}
          onCat={setCat}
          catLabel={RAIL_LABEL[tab]}
        >
          {!all ? (
            err ? null : (
              <Loading />
            )
          ) : rows.length === 0 ? (
            <EmptyState title={EMPTY[tab].title}>{EMPTY[tab].body}</EmptyState>
          ) : (
            <GroupedRows
              rows={shown}
              activeName={sel?.name}
              hrefOf={(r) => `#/factories/${tab}/${enc(r.name)}`}
              pills={PILLS[tab]}
            />
          )}
        </LibList>

        <article className="lib-reader" aria-label="Entry">
          {gone ? (
            <EmptyState
              title={
                <>
                  <code className="mono">{item}</code> is not registered any more.
                </>
              }
              docs={{ href: `#/factories/${tab}`, label: `All ${label.toLowerCase()} →` }}
            />
          ) : !sel ? (
            tab === 'active' && all && rows.length ? (
              <RunBoard runs={shown} />
            ) : tab === 'active' && all ? (
              <EmptyState
                title="What is a factory?"
                docs={{ href: '#/docs/factories', label: 'How factories work →' }}
              >
                A factory runs stages, bricks and whole loops, until the work is an open PR.
              </EmptyState>
            ) : null
          ) : tab === 'active' ? (
            <RunDetail
              run={sel}
              bricks={bricks}
              loops={loops}
              from={install ? installTag(install) : null}
            />
          ) : (
            <FactoryDetail key={sel.name} f={sel} bricks={bricks} loops={loops} />
          )}
        </article>
      </div>
    </div>
  )
}
