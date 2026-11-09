import React, { useState } from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'
import { usePoll } from '../hooks/usePoll.js'
import ErrorState from '../components/ErrorState.jsx'
import EmptyState from '../components/EmptyState.jsx'
import CopyButton from '../components/CopyButton.jsx'
import Loading from '../components/Loading.jsx'
import FactoryGraph from '../components/FactoryGraph.jsx'
import { GroupedRows, LibList, filterRows } from '../components/LibRows.jsx'
import RailCats, { groupsOf } from '../components/RailCats.jsx'
import { TONE } from '../components/ActiveLoops.jsx'
import { layoutFactory } from '../lib/factoryFlow.js'
import { TABS, TAB_LABELS } from '../lib/router.js'
import InstallPicker from '../components/InstallPicker.jsx'
import { useInstallPick, useInstalls } from '../hooks/useInstalls.js'
import { pairOf } from '../lib/hosts.js'

const enc = encodeURIComponent
const POLL_MS = 5000

// The rail's sections, in order: the router's `#/factories/<id>` tabs, under their tab labels.
const SECTIONS = TABS.factories.map((k) => [k, TAB_LABELS[k]])
const ORIGIN = { project: 'Project', global: 'Global', shipped: 'Shipped' }
const RAIL_LABEL = { templates: 'Origins', active: 'Statuses' }
// Runs by what they need from you, as Loops › Active orders loops.
const STATUS = [
  ['awaiting', 'Awaiting'],
  ['running', 'Running'],
  ['done', 'Done · stopped'],
  ['stopped', 'Done · stopped'],
  ['finished', 'Finished · unreadable'],
  ['unreadable', 'Finished · unreadable'],
]
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

const tag = (cls, text) => (
  <span key={text} className={`tag${cls ? ` ${cls}` : ''}`}>
    {text}
  </span>
)
const PILLS = {
  templates: (f) => tag('', f.origin),
  active: (r) => tag(TONE[r.status], r.status),
}

// The factory's graph at its own width, scrolled when wider than the reader.
function Graph(props) {
  const { width } = layoutFactory(props.factory, props.bricks)
  return (
    <div className="fg-wrap" style={{ '--fg-w': `${width}px` }}>
      <FactoryGraph {...props} />
    </div>
  )
}

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
  const cmd = `geneseed factory init --factory ${f.name} --title "<title>" --requirement "<requirement>"`
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
            Start it in a worktree
          </h3>
          <CopyButton text={cmd} label="Copy command" />
        </div>
        <pre className="mono">{cmd}</pre>
      </section>
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

function RunDetail({ run, bricks, loops }) {
  const t = run.tasks
  return (
    <>
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
          />
          <Cycles factory={run.graph} counters={run.counters} />
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
        Start one with <code className="mono">geneseed factory init</code> in a worktree, or ask the
        agent to run a factory. It shows up here while it runs.
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
      Factory runs registered on this machine, read from their FACTORY.md.{' '}
      <a href="#/docs/run-a-factory">Run a factory →</a>
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
  return { runs: data?.factories ?? null, error }
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
  const all = tab === 'active' ? runs && runRows(runs) : data && factoryRows(data.factories)
  const rows = all || []
  const cats = groupsOf(rows)
  const pool = cat === 'all' ? rows : rows.filter((r) => r.group === cat)
  const ql = q.trim()
  const shown = filterRows(pool, ql)
  const gone = !!(item && all && !rows.some((r) => r.name === item))
  const sel = gone
    ? null
    : rows.find((r) => r.name === item) ||
      (tab === 'active' ? rows.find(live) || rows[0] : rows[0]) ||
      null
  const counts = { templates: data?.factories.length, active: runs?.length }
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
            tab === 'active' && all ? (
              <EmptyState
                title="What is a factory?"
                docs={{ href: '#/docs/factories', label: 'How factories work →' }}
              >
                A factory runs stages, bricks and whole loops, until the work is an open PR.
              </EmptyState>
            ) : null
          ) : tab === 'active' ? (
            <RunDetail run={sel} bricks={bricks} loops={loops} />
          ) : (
            <FactoryDetail key={sel.name} f={sel} bricks={bricks} loops={loops} />
          )}
        </article>
      </div>
    </div>
  )
}
