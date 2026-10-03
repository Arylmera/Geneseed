import React from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'
import Tabs from '../components/Tabs.jsx'
import ErrorState from '../components/ErrorState.jsx'
import Loading from '../components/Loading.jsx'
import RingGraph from '../components/RingGraph.jsx'
import ActiveLoops from '../components/ActiveLoops.jsx'

const enc = encodeURIComponent

// "apply (project, overrides shipped)" -> "overrides shipped", for the brick it names. A
// brick overridden twice (project over global over shipped) reports the last word.
function overrideOf(overridden, name) {
  const row = overridden.filter((o) => o.startsWith(`${name} (`)).at(-1)
  return row ? /(overrides \w+)\)$/.exec(row)?.[1] : null
}

// One brick: what it does to the tree (mutate highlighted — the step the engine validates
// before), who runs it, where it comes from, how it can end. `full` (the Bricks tab) adds
// why an unavailable brick is unavailable and its source.
function BrickCard({ brick, name, override, full }) {
  if (!brick) {
    return (
      <div className="panel loop-brick dimmed" id={`brick-${name}`}>
        <b>{name}</b>
        <p className="panel-note">Not in the catalogue: this template cannot run as is.</p>
      </div>
    )
  }
  return (
    <div
      className={`panel loop-brick${brick.available === false ? ' dimmed' : ''}`}
      id={`brick-${brick.name}`}
    >
      <div className="loop-brick-head">
        <b>{brick.name}</b>
        <span className={`tag${brick.effect === 'mutate' ? ' warn' : ''}`}>{brick.effect}</span>
        <span className="tag">{brick.agent || brick.skill}</span>
        <span className="tag">{brick.origin}</span>
        {override ? <span className="tag acc">{override}</span> : null}
      </div>
      <p className="loop-brick-desc">{brick.description}</p>
      <p className="panel-note">outcomes: {brick.outcomes.join(' · ')}</p>
      {full && brick.available === false ? (
        <p className="panel-note t-warn">Unavailable: {brick.reason}</p>
      ) : null}
      {full ? (
        <details>
          <summary className="panel-note">Source</summary>
          <pre className="loop-brick-src">{brick.body}</pre>
        </details>
      ) : null}
    </div>
  )
}

// The files the catalogue skipped (bad frontmatter, not JSON, misnamed), on every tab: a
// broken team override would otherwise just be missing, with nothing saying why.
function Problems({ problems }) {
  if (!problems?.length) return null
  const n = problems.length
  return (
    <div className="panel loop-problems" role="status" aria-label="Catalogue files skipped">
      <b className="t-warn">
        {n} catalogue {n === 1 ? 'problem' : 'problems'}: these files were skipped
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

function Templates({ data, item }) {
  const { templates, bricks, overridden } = data
  if (!templates.length) {
    return (
      <div className="empty">
        <div className="big">No templates</div>
        Add one under <code className="mono">.geneseed/loops/</code> in the repo.
      </div>
    )
  }
  const sel = templates.find((t) => t.name === item) || templates[0]
  const byName = new Map(bricks.map((b) => [b.name, b]))
  const toCard = (name) =>
    document
      .getElementById(`brick-${name}`)
      ?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
  return (
    <>
      <div className="loop-templates">
        {templates.map((t) => (
          <a
            key={t.name}
            href={`#/loops/templates/${enc(t.name)}`}
            className={`panel loop-tpl${t === sel ? ' on' : ''}`}
            aria-current={t === sel ? 'true' : undefined}
          >
            <b>{t.name}</b>
            <span className="panel-note">{t.description}</span>
            <span className="tag">{t.origin}</span>
          </a>
        ))}
      </div>
      <div className="panel loop-graph">
        <RingGraph graph={sel.graph} bricks={bricks} onSelect={toCard} />
      </div>
      <h2 className="loop-h2">Bricks in {sel.name}</h2>
      <div className="loop-bricks">
        {sel.graph.nodes.map((n) => (
          <BrickCard key={n} name={n} brick={byName.get(n)} override={overrideOf(overridden, n)} />
        ))}
      </div>
    </>
  )
}

function Bricks({ data }) {
  if (!data.bricks.length) {
    return (
      <div className="empty">
        <div className="big">No bricks</div>
        Add one under <code className="mono">.geneseed/bricks/</code> in the repo.
      </div>
    )
  }
  return (
    <div className="loop-bricks">
      {data.bricks.map((b) => (
        <BrickCard
          key={b.name}
          name={b.name}
          brick={b}
          override={overrideOf(data.overridden, b.name)}
          full
        />
      ))}
    </div>
  )
}

// The Loops page: the templates `geneseed loop` runs, drawn as rings, and the bricks they are
// built from — files (src/, the user's config dir, the repo's .geneseed/), read-only here, and
// this page shows which one won. "Active" is the live-run view (components/ActiveLoops.jsx):
// it does not wait on the catalogue, which it only borrows bricks from for the ring's gate.
export default function Loops({ tab = 'templates', item, dataRev }) {
  const { data, error } = useAsync(() => api.loops(), [dataRev], 'loops')
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="h">Loops</h1>
          <p className="sub">Templates the loop engine runs, and the bricks they are built from.</p>
        </div>
      </div>
      <Tabs
        page="loops"
        current={tab}
        label="Loops"
        badges={data ? { templates: data.templates.length, bricks: data.bricks.length } : {}}
      />
      <ErrorState error={error} style={{ margin: '0 0 12px' }} />
      <Problems problems={data?.problems} />
      {tab === 'active' ? (
        <ActiveLoops item={item} bricks={data?.bricks || []} />
      ) : !data ? (
        error ? null : (
          <Loading />
        )
      ) : tab === 'bricks' ? (
        <Bricks data={data} />
      ) : (
        <Templates data={data} item={item} />
      )}
    </>
  )
}
