import React, { useState } from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'
import ErrorState from '../components/ErrorState.jsx'
import Loading from '../components/Loading.jsx'
import RingGraph from '../components/RingGraph.jsx'
import Markdown from '../components/Markdown.jsx'
import { GroupedRows, LibList, filterRows } from '../components/LibRows.jsx'
import RailCats, { groupsOf } from '../components/RailCats.jsx'
import { ActiveDetail, TONE, live, useActiveLoops } from '../components/ActiveLoops.jsx'
import { humanGate } from '../lib/loopRing.js'
import { TABS, TAB_LABELS } from '../lib/router.js'

const enc = encodeURIComponent

// The rail's sections, in order: the router's `#/loops/<id>` tabs, under their tab labels.
const SECTIONS = TABS.loops.map((k) => [k, TAB_LABELS[k]])
// A template's `category` (js/loop/graph.mjs CATEGORIES) -> its list heading, in shelf order;
// a template without one goes last, under Other. The headings are uppercased by `.lib-group`.
const CATEGORY = {
  architecture: 'Architecture',
  tests: 'Tests',
  development: 'Development',
  refactoring: 'Refactoring',
  'day-to-day': 'Day-to-day',
}
const ORIGIN = { project: 'Project', global: 'Global', shipped: 'Shipped' }
// What the categories under each section in the rail are, for a screen reader.
const RAIL_LABEL = { templates: 'Categories', bricks: 'Origins', active: 'Statuses' }
// Loops › Active by what they need from you: awaiting (it waits on the user) first, then the
// running ones, then those over, and last the ones with nothing left to show.
const STATUS = [
  ['awaiting', 'Awaiting'],
  ['running', 'Running'],
  ['done', 'Done · stopped'],
  ['stopped', 'Done · stopped'],
  ['finished', 'Finished · unreadable'],
  ['unreadable', 'Finished · unreadable'],
]

// "apply (project, overrides shipped)" -> "overrides shipped", for the brick it names. A
// brick overridden twice (project over global over shipped) reports the last word.
function overrideOf(overridden, name) {
  const row = overridden.filter((o) => o.startsWith(`${name} (`)).at(-1)
  return row ? /(overrides \w+)\)$/.exec(row)?.[1] : null
}

// Stable-sort `items` into `order`'s groups, tagging each row with its heading.
const grouped = (items, keyOf, order) =>
  order.flatMap(([k, label]) =>
    items.filter((it) => keyOf(it) === k).map((it) => ({ ...it, group: label })),
  )

// The three lists as rows for the list pane (`name` is the row's id, `title` what it prints,
// `desc` its one line). Exported for the test that pins their order.
export function templateRows(templates, bricks) {
  const gated = new Set(bricks.filter((b) => b.gate === 'human').map((b) => b.name))
  const rows = templates.map((t) => ({
    ...t,
    desc: t.description,
    human: t.graph.nodes.some((n) => gated.has(n)),
  }))
  const cat = (t) => (CATEGORY[t.graph.category] ? t.graph.category : 'other')
  return grouped(rows, cat, [...Object.entries(CATEGORY), ['other', 'Other']])
}
export function brickRows(bricks, overridden) {
  const rows = bricks.map((b) => ({
    ...b,
    desc: b.description,
    override: overrideOf(overridden, b.name),
  }))
  return grouped(rows, (b) => b.origin, Object.entries(ORIGIN))
}
export function activeRows(loops) {
  const rows = loops.map((l) => ({ ...l, name: l.root, desc: l.branch }))
  return grouped(rows, (l) => l.status, STATUS)
}

const tag = (cls, text) => (
  <span key={text} className={`tag${cls ? ` ${cls}` : ''}`}>
    {text}
  </span>
)
const PILLS = {
  templates: (t) => (t.human ? tag('human', 'human gate') : null),
  bricks: (b) => [
    b.effect === 'mutate' ? tag('warn', 'mutate') : null,
    humanGate(b) ? tag('human', 'human gate') : null,
    b.override ? tag('acc', b.override) : null,
    b.available === false ? tag('bad', 'unavailable') : null,
  ],
  active: (l) => tag(TONE[l.status], l.status),
}

// One brick of a template, as a compact row: name, effect (mutate highlighted — the step the
// engine validates before), who runs it, how it can end, and its human gate. `on` is the brick
// whose ring node was just clicked.
function BrickLine({ name, brick, override, on }) {
  const cls = `loop-brick${on ? ' on' : ''}${!brick || brick.available === false ? ' dimmed' : ''}`
  if (!brick) {
    return (
      <li className={cls} id={`brick-${name}`}>
        <b>{name}</b>
        <span className="panel-note">Not in the catalogue: this template cannot run as is.</span>
      </li>
    )
  }
  return (
    <li className={cls} id={`brick-${name}`}>
      <b>
        <a href={`#/loops/bricks/${enc(name)}`}>{name}</a>
      </b>
      {tag(brick.effect === 'mutate' ? 'warn' : '', brick.effect)}
      <span className="mono dim">{brick.agent || brick.skill}</span>
      <span className="panel-note">{brick.outcomes.join(' · ')}</span>
      {humanGate(brick) ? tag('human', humanGate(brick).toLowerCase()) : null}
      {override ? tag('acc', override) : null}
    </li>
  )
}

function TemplateDetail({ t, bricks, overridden }) {
  const [lit, setLit] = useState(null)
  const byName = new Map(bricks.map((b) => [b.name, b]))
  const toRow = (name) => {
    setLit(name)
    document
      .getElementById(`brick-${name}`)
      ?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
  }
  return (
    <>
      <div className="reader-tags">
        <span className="tag acc">Template</span>
        {CATEGORY[t.graph.category] ? tag('', CATEGORY[t.graph.category]) : null}
        {t.human ? tag('human', 'human gate') : null}
      </div>
      <h2 className="reader-title">{t.name}</h2>
      {t.description ? <p className="reader-lede">{t.description}</p> : null}
      <p className="mono dim reader-src">
        loops/{t.name}.json · {t.origin}
      </p>
      <hr className="hr" />
      <div className="loop-graph">
        <RingGraph graph={t.graph} bricks={bricks} onSelect={toRow} />
      </div>
      {t.graph.rules?.length ? (
        <>
          <h3 className="loop-h2">Rules</h3>
          <ul className="loop-rules" aria-label="Rules every brick follows">
            {t.graph.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </>
      ) : null}
      <h3 className="loop-h2">Bricks</h3>
      <ul className="loop-brick-list" aria-label={`Bricks in ${t.name}`}>
        {t.graph.nodes.map((n) => (
          <BrickLine
            key={n}
            name={n}
            brick={byName.get(n)}
            override={overrideOf(overridden, n)}
            on={lit === n}
          />
        ))}
      </ul>
    </>
  )
}

// The brick file as the catalogue parsed it, frontmatter then body, for "View source". Rebuilt
// from the parsed fields (js/loop/catalog.mjs parseBrick) rather than sent raw: `/api/loops`
// carries only the parse, and the parse is what the engine runs. Exported for its test.
export function brickSource(b) {
  const fm = [
    ['name', b.name],
    ['description', b.description],
    ['effect', b.effect],
    [b.agent ? 'agent' : 'skill', b.agent || b.skill],
    ['gate', b.gate],
    ['gateOn', b.gateOn?.join(', ')],
    ['outcomes', b.outcomes.join(', ')],
  ].filter(([, v]) => v)
  return `---\n${fm.map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n${b.body}`
}

function BrickDetail({ b }) {
  const [raw, setRaw] = useState(false)
  const facts = [
    ['effect', tag(b.effect === 'mutate' ? 'warn' : '', b.effect)],
    [
      b.agent ? 'agent' : 'skill',
      <span key="who" className="mono">
        {b.agent || b.skill}
      </span>,
    ],
    ['outcomes', b.outcomes.map((o) => tag('', o))],
    ['gate', humanGate(b) ? tag('human', humanGate(b).toLowerCase()) : 'none'],
    ['origin', b.override ? `${b.origin}, ${b.override}` : b.origin],
    [
      'available',
      b.available === false ? (
        <span key="why" className="t-warn">
          no — {b.reason}
        </span>
      ) : (
        'yes'
      ),
    ],
  ]
  return (
    <>
      <div className="reader-tags">
        <span className="tag acc">Brick</span>
        {PILLS.bricks(b)}
      </div>
      <h2 className="reader-title">{b.name}</h2>
      {b.description ? <p className="reader-lede">{b.description}</p> : null}
      <p className="mono dim reader-src">bricks/{b.name}.md</p>
      <dl className="loop-facts">
        {facts.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </React.Fragment>
        ))}
      </dl>
      <hr className="hr" />
      <div className="row gap-8 loop-src-bar">
        <button
          type="button"
          className="btn ghost sm"
          aria-expanded={raw}
          onClick={() => setRaw(!raw)}
        >
          {raw ? 'Hide source' : 'View source'}
        </button>
      </div>
      {raw ? (
        <pre className="loop-brick-src" aria-label="Source">
          {brickSource(b)}
        </pre>
      ) : (
        <div className="lib-doc detail-doc">
          <Markdown body={b.body} />
        </div>
      )}
    </>
  )
}

// The files the catalogue skipped (bad frontmatter, not JSON, misnamed), on every section: a
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

const EMPTY = {
  templates: (
    <>
      <div className="big">No templates</div>
      Add one under <code className="mono">.geneseed/loops/</code> in the repo.
    </>
  ),
  bricks: (
    <>
      <div className="big">No bricks</div>
      Add one under <code className="mono">.geneseed/bricks/</code> in the repo.
    </>
  ),
  active: (
    <>
      <div className="big">No loops yet</div>
      Start one with <code className="mono">geneseed loop init</code> in a worktree, or ask the
      agent to run a loop. It shows up here while it runs.
    </>
  ),
}

// The Loops page, in the Library's three panes: a rail of sections (Templates, Bricks, Active),
// the section's list — filtered, grouped (a template by category, a brick by origin, a run by
// status) — and the selected entry. Templates and bricks are files (src/, the user's config
// dir, the repo's .geneseed/), read-only here; Active is the live-run view, polled, and does
// not wait on the catalogue, which it only borrows bricks from for the ring's gate. Routing:
// `#/loops`, `#/loops/<section>`, `#/loops/<section>/<item>` (a run's item is its root).
export default function Loops({ tab = 'templates', item, dataRev }) {
  const { data, error } = useAsync(() => api.loops(), [dataRev], 'loops')
  const runs = useActiveLoops()
  const [q, setQ] = useState('')
  // The group picked under the section in the rail ('all' or a group heading).
  const [cat, setCat] = useState('all')
  // Filter text and the picked group belong to one section: drop them when the route moves
  // to another.
  const [seenTab, setSeenTab] = useState(tab)
  if (tab !== seenTab) {
    setSeenTab(tab)
    setQ('')
    setCat('all')
  }

  const bricks = data?.bricks || []
  const all =
    tab === 'active'
      ? runs.loops && activeRows(runs.loops)
      : data &&
        (tab === 'bricks'
          ? brickRows(data.bricks, data.overridden)
          : templateRows(data.templates, data.bricks))
  const rows = all || []
  // The section's groups (template shelves, brick origins, run statuses) as the rail's
  // categories under it; picking one narrows the list, and the filter narrows within it.
  const cats = groupsOf(rows)
  const pool = cat === 'all' ? rows : rows.filter((r) => r.group === cat)
  const ql = q.trim()
  const shown = filterRows(pool, ql)
  // The routed entry, or the first row (Active: the first live one) so the list and the
  // reader always agree.
  const sel =
    rows.find((r) => r.name === item) ||
    (tab === 'active' ? rows.find(live) || rows[0] : rows[0]) ||
    null
  const counts = {
    templates: data?.templates.length,
    bricks: data?.bricks.length,
    active: runs.loops?.length,
  }
  const total = (counts.templates ?? 0) + (counts.bricks ?? 0) + (counts.active ?? 0)
  const share = (n) => `${total ? ((n ?? 0) / total) * 100 : 0}%`
  const label = SECTIONS.find(([k]) => k === tab)[1]
  const err = tab === 'active' ? runs.error : error

  return (
    <>
      <ErrorState error={err} style={{ margin: '0 0 12px' }} />
      <Problems problems={data?.problems} />
      <div className="library">
        <aside className="lib-kinds" aria-label="Loops sections">
          <div className="lib-title">
            <h1 className="h">Loops</h1>
            <span className="dim">What the engine runs</span>
          </div>
          <div className="stackbar thin" aria-hidden="true">
            <span className="sb-invariants" style={{ width: share(counts.templates) }} />
            <span className="sb-doctrines" style={{ width: share(counts.bricks) }} />
            <span className="sb-rest" style={{ width: share(counts.active) }} />
          </div>
          <nav className="kind-list" aria-label="Sections">
            {SECTIONS.map(([k, l]) => (
              <React.Fragment key={k}>
                <a
                  href={`#/loops/${k}`}
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
            <div className="empty" style={{ padding: 32 }}>
              {EMPTY[tab]}
            </div>
          ) : (
            <GroupedRows
              rows={shown}
              activeName={sel?.name}
              hrefOf={(r) => `#/loops/${tab}/${enc(r.name)}`}
              pills={PILLS[tab]}
            />
          )}
        </LibList>

        <article className="lib-reader" aria-label="Entry">
          {!sel ? null : tab === 'active' ? (
            <ActiveDetail loop={sel} bricks={bricks} onPreset={runs.onPreset} />
          ) : tab === 'bricks' ? (
            <BrickDetail b={sel} />
          ) : (
            <TemplateDetail key={sel.name} t={sel} bricks={bricks} overridden={data.overridden} />
          )}
        </article>
      </div>
    </>
  )
}
