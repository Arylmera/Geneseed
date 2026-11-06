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
import { installTag } from '../lib/hosts.js'

const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`

// Each folder's own index and README are furniture, not entries (any case, as the server counts).
const FURNITURE = new Set(['MEMORY', 'NOTEBOOK', 'README'])
const countOf = (catalog) =>
  catalog
    ? (catalog.items || []).filter((i) => !FURNITURE.has(String(i.name).toUpperCase())).length
    : null

// The panel over the rules editor: how much the agent has been told about you across your files.
// On a global install the rules, profile and memory are the one shared tier, and that is what the
// note says, naming no harness. A project install's rules and profile are its own, so it names the
// install (`tag`, the default, once two are active).
function KnownCard({ rules, profile, facts, notes, tag, projects }) {
  const st = rules?.exists ? rules.stats : null
  if (!st) return null
  const known = [
    {
      k: 'Profile',
      v: profile?.seeded ? 'template' : profile?.exists ? 'written' : 'missing',
      warn: !!profile?.seeded,
    },
    { k: 'Rules', v: plural(st.rules, 'rule') },
    { k: 'Memory', v: facts == null ? 'n/a' : plural(facts, 'fact') },
    { k: 'Notebook', v: notes == null ? 'n/a' : plural(notes, 'note') },
  ]
  return (
    <section className="panel pm-topics" aria-labelledby="pc-known">
      <div className="panel-head">
        <h2 id="pc-known">What the agent knows about you</h2>
      </div>
      <ul className="hbars">
        {known.map((r) => (
          <li key={r.k}>
            <span className="hb-label">{r.k}</span>
            <span className={`mono hb-n${r.warn ? ' warn' : ''}`}>{r.v}</span>
          </li>
        ))}
      </ul>
      {tag ? (
        <p className="panel-note">
          {!rules.shared
            ? `Profile and rules of ${tag}; memory and notebook across every install.`
            : projects
              ? 'Profile and rules are shared by every harness; memory counts the shared store and each project’s own, and the notebook every install.'
              : 'Profile, rules and memory are shared by every harness; the notebook counts every install.'}
        </p>
      ) : null}
    </section>
  )
}

// A topic line of the generated memory map, as js/hosts/memory-files.mjs writeMap writes it
// (js/hosts/hooks-context.mjs reads the same line). An old flat map has none.
const MAP_TOPIC_RE = /^- \[([^\]]*)\]\(topics\/[^)]+\.md\) — (\d+) facts?$/
const topicsOf = (body) =>
  String(body || '')
    .split('\n')
    .map((l) => MAP_TOPIC_RE.exec(l.trim()))
    .filter(Boolean)
    .map((m) => ({ topic: m[1], n: Number(m[2]) }))

// The map is one store's. The shared store is every harness's, so the panel names none; a
// project install's own store (the first that has it, `install`) is named.
function Topics({ topics, install, shared }) {
  if (!topics.length) return null
  return (
    <section className="panel pm-topics" aria-labelledby="pm-topics">
      <div className="panel-head">
        <h2 id="pm-topics">Topics</h2>
        {shared ? (
          <span className="mono dim">shared</span>
        ) : install ? (
          <span className="mono dim">{installLabel(install)}</span>
        ) : null}
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
export default function Personal({ tab = 'rules', item, dataRev }) {
  const soft = (p) => Promise.resolve(p).catch(() => null)
  // Each editor reloads only its own file after a write, so the cards above it follow. Not
  // the app-wide `dataRev`: neither file feeds the overview, the fleet or an install.
  const { data: rules, reload: reloadRules } = useRules(dataRev)
  // The install the unnamed reads above answer for (the default), named once two are active.
  const active = useInstalls(dataRev)
  const tag = active?.length > 1 ? installTag(active[0]) : null
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
  const badges = {
    rules: rules?.stats?.rules,
    profile: profile?.seeded ? 'template' : null,
    memory: facts,
    notebook: notes,
  }
  const folder = tab === 'memory' || tab === 'notebook'
  return (
    <>
      <PageHeader
        title="Personal"
        sub="The only files you write. They survive updates, reinstalls and voice changes."
      />
      <Tabs page="personal" current={tab} badges={badges} label="Personal files" />
      {tab === 'rules' && (
        <>
          <KnownCard
            rules={rules}
            profile={profile}
            facts={facts}
            notes={notes}
            tag={tag}
            projects={active?.some((i) => i.scope === 'project')}
          />
          <Rules onChanged={reloadRules} dataRev={dataRev} />
        </>
      )}
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
            // A promote deletes the fact it turns into a rule, so both counts move.
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
