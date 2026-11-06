import React from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'
import { useRules } from '../hooks/useRules.js'
import Tabs from '../components/Tabs.jsx'
import PageHeader from '../components/PageHeader.jsx'
import EmptyState from '../components/EmptyState.jsx'
import Rules from './Rules.jsx'
import Profile from './Profile.jsx'
import Library, { installLabel } from './Library.jsx'
import { useInstalls } from '../hooks/useInstalls.js'

const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`

// The catalog lists entries only: a folder's index and README never reach it.
const countOf = (catalog) => (catalog ? (catalog.items || []).length : null)

// A topic line of the generated memory map, as js/hosts/memory-files.mjs writeMap writes it
// (js/hosts/hooks-context.mjs reads the same line). An old flat map has none.
const MAP_TOPIC_RE = /^- \[([^\]]*)\]\(topics\/[^)]+\.md\) — (\d+) facts?$/
const topicsOf = (body) =>
  String(body || '')
    .split('\n')
    .map((l) => MAP_TOPIC_RE.exec(l.trim()))
    .filter(Boolean)
    .map((m) => ({ topic: m[1], n: Number(m[2]) }))

// The map is one store's. The header states the shared one; a project install's own store (the
// first that has it, `install`) is named here.
function Topics({ topics, install, shared }) {
  if (!topics.length) return null
  return (
    <section className="panel pm-topics" aria-labelledby="pm-topics">
      <div className="panel-head">
        <h2 id="pm-topics">Topics</h2>
        {install && !shared ? <span className="mono dim">{installLabel(install)}</span> : null}
        <span className="mono dim">{plural(topics.length, 'topic')}</span>
      </div>
      <ul className="hbars">
        {topics.map((t) => (
          <li key={t.topic}>
            <span className="hb-label">{t.topic}</span>
            <span className="mono hb-n">{plural(t.n, 'fact')}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

const EMPTY = {
  memory: {
    title: 'No facts yet',
    body: (
      <div className="pm-first">
        <p>
          The agent writes a fact when a session teaches it something durable: a decision, a
          correction, a trap. Say “remember that…” in any session, and it asks whether that belongs
          here or in your standing rules.
        </p>
        <ul>
          <li>One fact per file, filed under a topic.</li>
          <li>Stale facts move to Archived; nothing is deleted without you.</li>
          <li>The store stays on this machine and out of git.</li>
        </ul>
      </div>
    ),
    action: (
      <>
        <a className="btn ghost" href="#/docs/memory">
          How memory works
        </a>
        <a className="btn ghost" href="#/item/skill/rule">
          The rule skill
        </a>
      </>
    ),
  },
  notebook: {
    title: 'No notes yet',
    body: 'The notebook is the agent’s own scratch space: plans and notes it keeps for itself.',
  },
}

// Personal: the files that are yours alone and survive every update, reinstall and voice
// change. Rules and Profile are editors; Memory and Notebook are the Library reader
// locked to one kind, so an entry opened here keeps its address on this page.
export default function Personal({ tab = 'rules', item, dataRev, onCountsChanged }) {
  const soft = (p) => Promise.resolve(p).catch(() => null)
  const active = useInstalls(dataRev)
  // Each editor reloads only its own file after a write: the rules for the Overview and the
  // Constitution, which paint that copy, the profile for the tab's "template" badge. Not the
  // app-wide `dataRev`: neither file feeds the overview, the fleet or an install.
  const { reload: reloadRules } = useRules(dataRev)
  const { data: profile, reload: reloadProfile } = useAsync(() => soft(api.profile()), [dataRev])
  // The same key and deps as Library's own read of each folder, so the count here and the
  // pane share one fetch, and a delete in the pane moves the count. No `soft`: a cached null
  // would be served to the pane's next mount instead of a fetch.
  const { data: memory, reload: reloadMemory } = useAsync(
    () => api.catalog('memory'),
    ['memory', dataRev],
    'catalog',
  )
  const { data: notebook } = useAsync(
    () => api.catalog('notebook'),
    ['notebook', dataRev],
    'catalog',
  )
  const facts = countOf(memory)
  // The topics come from the map, the store's own tally (the rows' `topic` groups the list). Keyed
  // on the fact count, so a promote or a forget in the pane (both rewrite the map) refetches it.
  const { data: map } = useAsync(
    () => (tab === 'memory' ? soft(api.item('memory', 'MEMORY')) : Promise.resolve(null)),
    ['memory-map', tab, dataRev, facts],
  )
  const notes = countOf(notebook)
  const counts = { memory: facts, notebook: notes }
  // No rules figure: each rules file heads its own list with its count and cost.
  const badges = {
    profile: profile?.seeded ? 'template' : null,
    memory: facts,
    notebook: notes,
  }
  const folder = tab === 'memory' || tab === 'notebook'
  return (
    <>
      <PageHeader
        title="Personal"
        sub={
          'The only files you write. They survive updates, reinstalls and voice changes.' +
          (active?.some((i) => i.shared)
            ? ' Global installs share one copy of the rules, profile and memory; a project install keeps its own.'
            : '')
        }
      />
      <Tabs page="personal" current={tab} badges={badges} label="Personal files" />
      {tab === 'rules' && <Rules onChanged={reloadRules} dataRev={dataRev} />}
      {tab === 'profile' && <Profile onChanged={reloadProfile} dataRev={dataRev} />}
      {folder && counts[tab] === 0 && !item ? (
        <EmptyState title={EMPTY[tab].title} action={EMPTY[tab].action}>
          {EMPTY[tab].body}
        </EmptyState>
      ) : folder ? (
        <>
          {tab === 'memory' && (
            <Topics topics={topicsOf(map?.body)} install={map?.install} shared={map?.shared} />
          )}
          <Library
            key={tab}
            lock={tab}
            base={`#/personal/${tab}`}
            selected={item}
            dataRev={dataRev}
            onCountsChanged={onCountsChanged}
            // A promote deletes the fact it turns into a rule, so both reads move.
            onRulesChanged={() => {
              reloadRules()
              reloadMemory()
            }}
          />
        </>
      ) : null}
    </>
  )
}
