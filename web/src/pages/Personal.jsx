import React, { useState } from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'
import Tabs from '../components/Tabs.jsx'
import Rules from './Rules.jsx'
import Profile from './Profile.jsx'
import Library from './Library.jsx'

const pct = (n, of) => `${of ? Math.min(100, (n / of) * 100) : 0}%`

// The three cards over the rules editor: what the rule file costs every turn, how many of
// its slots are used, and how much the agent has been told about you across your files.
function RuleCards({ rules, profile, facts, notes }) {
  const st = rules?.exists ? rules.stats : null
  if (!st) return null
  const known = [
    {
      k: 'Profile',
      v: profile?.seeded ? 'template' : profile?.exists ? 'written' : 'missing',
      fill: profile?.exists && !profile.seeded ? 1 : 0,
      warn: !!profile?.seeded,
    },
    { k: 'Rules', v: `${st.rules}/${st.max_rules}`, fill: st.rules / st.max_rules },
    { k: 'Memory', v: facts == null ? 'n/a' : `${facts} facts`, fill: facts ? 1 : 0 },
    { k: 'Notebook', v: notes == null ? 'n/a' : `${notes} notes`, fill: notes ? 1 : 0 },
  ]
  return (
    <div className="card-row">
      <section className="panel" aria-labelledby="pc-budget">
        <div className="panel-head">
          <h2 id="pc-budget">Token budget</h2>
          <span className="mono dim">loaded every turn</span>
        </div>
        <p className="big-num">
          <span className="mono">{st.tokens}</span>{' '}
          <span className="dim">/ {st.max_tokens.toLocaleString('en-US')} tokens</span>
        </p>
        <span className={`hbar${st.tokens > st.max_tokens ? ' bad' : ''}`} aria-hidden="true">
          <span style={{ width: pct(st.tokens, st.max_tokens) }} />
        </span>
        <p className="panel-note">
          {st.rules
            ? `${st.rules} rules in ${st.lines} lines.`
            : 'All of it is the file’s preamble; no rule text yet.'}
        </p>
      </section>
      <section className="panel" aria-labelledby="pc-slots">
        <div className="panel-head">
          <h2 id="pc-slots">Rule slots</h2>
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
        <p className="panel-note">Trial rules graduate once they have held.</p>
      </section>
      <section className="panel" aria-labelledby="pc-known">
        <div className="panel-head">
          <h2 id="pc-known">What the agent knows about you</h2>
        </div>
        <ul className="hbars">
          {known.map((r) => (
            <li key={r.k}>
              <span className="hb-label">{r.k}</span>
              <span className="hb-track" aria-hidden="true">
                <span className="hb-ok" style={{ width: pct(r.fill, 1) }} />
              </span>
              <span className={`mono hb-n${r.warn ? ' warn' : ''}`}>{r.v}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

// Personal: the files that are yours alone and survive every update, reinstall and voice
// change. Rules and Profile are editors; Memory and Notebook are the Library reader
// locked to one kind, so an entry opened here keeps its address on this page.
export default function Personal({ tab = 'rules', item, setup, dataRev }) {
  // Bumped by the rules editor after every write, so the cards above it follow.
  const [rev, setRev] = useState(0)
  const soft = (p) => Promise.resolve(p).catch(() => null)
  const { data: rules } = useAsync(() => soft(api.rules()), [dataRev, rev])
  const { data: profile } = useAsync(() => soft(api.profile()), [dataRev, rev])
  const { data: notebook } = useAsync(() => soft(api.catalog('notebook')), [dataRev], 'catalog')
  // The notebook's own index and README are furniture, not notes.
  const notes = notebook
    ? (notebook.items || []).filter((i) => i.name !== 'NOTEBOOK' && i.name !== 'README').length
    : null
  const facts = setup?.facts ?? null
  const badges = {
    rules: rules?.stats?.rules,
    profile: profile?.seeded ? '●' : null,
    memory: facts,
    notebook: notes,
  }
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="h">Personal</h1>
          <p className="sub">
            The only files you write. They survive updates, reinstalls and voice changes.
          </p>
        </div>
      </div>
      <Tabs page="personal" current={tab} badges={badges} label="Personal files" />
      {tab === 'rules' && (
        <>
          <RuleCards rules={rules} profile={profile} facts={facts} notes={notes} />
          <Rules onChanged={() => setRev((v) => v + 1)} />
        </>
      )}
      {tab === 'profile' && <Profile onChanged={() => setRev((v) => v + 1)} />}
      {(tab === 'memory' || tab === 'notebook') && (
        <Library
          key={tab}
          lock={tab}
          base={`#/personal/${tab}`}
          selected={item}
          dataRev={dataRev}
        />
      )}
    </>
  )
}
