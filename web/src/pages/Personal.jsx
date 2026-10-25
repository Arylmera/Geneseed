import React from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'
import { useRules } from '../hooks/useRules.js'
import Tabs from '../components/Tabs.jsx'
import PageHeader from '../components/PageHeader.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { Bar } from '../components/StackBar.jsx'
import Rules from './Rules.jsx'
import Profile from './Profile.jsx'
import Library from './Library.jsx'

const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`

// Each folder's own index and README are furniture, not entries (any case, as the server counts).
const FURNITURE = new Set(['MEMORY', 'NOTEBOOK', 'README'])
const countOf = (catalog) =>
  catalog
    ? (catalog.items || []).filter((i) => !FURNITURE.has(String(i.name).toUpperCase())).length
    : null

// The two panels over the rules editor: the one budget the rule file spends every turn, and
// how much the agent has been told about you across your files.
function RuleCards({ rules, profile, facts, notes }) {
  const st = rules?.exists ? rules.stats : null
  if (!st) return null
  // One threshold for the whole strip: whichever budget is closer to spent, count or tokens.
  const pct = Math.round(Math.max(st.rules / st.max_rules, st.tokens / st.max_tokens) * 100)
  const [tone, note] =
    pct >= 100
      ? ['bad', 'over budget: a bloated rule set dilutes the rules that matter']
      : pct >= 70
        ? ['warn', 'getting heavy; consider merging or pruning']
        : [
            'accent',
            st.rules
              ? `${st.rules} rules in ${st.lines} lines.`
              : 'All of it is the file’s preamble; no rule text yet.',
          ]
  const known = [
    {
      k: 'Profile',
      v: profile?.seeded ? 'template' : profile?.exists ? 'written' : 'missing',
      warn: !!profile?.seeded,
    },
    { k: 'Rules', v: `${st.rules}/${st.max_rules}` },
    { k: 'Memory', v: facts == null ? 'n/a' : plural(facts, 'fact') },
    { k: 'Notebook', v: notes == null ? 'n/a' : plural(notes, 'note') },
  ]
  return (
    <div className="card-row">
      <section className="panel" aria-labelledby="pc-budget">
        <div className="panel-head">
          <h2 id="pc-budget">Rule budget</h2>
          <span className="mono dim">
            {st.rules} of {st.max_rules}
          </span>
        </div>
        <div
          className="slots"
          style={{ '--slots': st.max_rules }}
          role="img"
          aria-label={`${st.rules} of ${st.max_rules} rule slots used`}
        >
          {Array.from({ length: st.max_rules }, (_, i) => (
            <span key={i} className={i < st.rules ? 'used' : ''} />
          ))}
        </div>
        <p className="big-num">
          <span className="mono">{st.tokens}</span>{' '}
          <span className="dim">/ {st.max_tokens.toLocaleString('en-US')} tokens, every turn</span>
        </p>
        <Bar value={st.tokens} max={st.max_tokens} label="tokens" tone={tone} />
        <p className="panel-note">{note}</p>
      </section>
      <section className="panel" aria-labelledby="pc-known">
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
      </section>
    </div>
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

function Topics({ topics }) {
  if (!topics.length) return null
  return (
    <section className="panel pm-topics" aria-labelledby="pm-topics">
      <div className="panel-head">
        <h2 id="pm-topics">Topics</h2>
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
          <RuleCards rules={rules} profile={profile} facts={facts} notes={notes} />
          <Rules onChanged={reloadRules} />
        </>
      )}
      {tab === 'profile' && <Profile onChanged={reloadProfile} />}
      {folder && counts[tab] === 0 && !item ? (
        <EmptyState title={EMPTY[tab].title} action={EMPTY[tab].action}>
          {EMPTY[tab].body}
        </EmptyState>
      ) : folder ? (
        <>
          {tab === 'memory' && <Topics topics={topicsOf(map?.body)} />}
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
