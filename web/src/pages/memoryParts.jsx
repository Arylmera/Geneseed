import React from 'react'
import { installLabel } from './Library.jsx'

// The memory store's shared parts: the topic chips and the empty state. They lived on Personal's Memory tab and
// moved with it to the Memory page (pages/Memory.jsx).

const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`

// A topic's family is its slug's first `-` segment: `geneseed`, `geneseed-decisions` and
// `geneseed-git` are one family. Sorted by family and then by full slug, the family sits together.
const familyOf = (slug) => slug.split('-')[0]
const byFamily = (a, b) => {
  const fa = familyOf(a.topic)
  const fb = familyOf(b.topic)
  if (fa !== fb) return fa < fb ? -1 : 1
  return a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0
}

// The map is one store's. The header states the shared one; a project install's own store (the
// first that has it, `install`) is named here. Each topic is a pill that narrows the fact list
// below to it (`picked`, `onPick`); the thin bar under a pill is its count against the largest.
export function Topics({ topics, install, shared, picked, onPick }) {
  if (!topics.length) return null
  const sorted = [...topics].sort(byFamily)
  const max = Math.max(1, ...sorted.map((t) => t.n))
  return (
    <section className="panel pm-topics" aria-labelledby="pm-topics">
      <div className="panel-head">
        <h2 id="pm-topics">Topics</h2>
        {install && !shared ? <span className="mono dim">{installLabel(install)}</span> : null}
        <span className="mono dim">{plural(topics.length, 'topic')}</span>
      </div>
      <ul className="pm-chips">
        {sorted.map((t, i) => (
          <li
            key={t.topic}
            className={i && familyOf(t.topic) !== familyOf(sorted[i - 1].topic) ? 'fam-start' : ''}
          >
            <button
              type="button"
              className={`chip-f pm-chip${picked === t.topic ? ' on' : ''}`}
              aria-pressed={picked === t.topic}
              onClick={() => onPick(picked === t.topic ? null : t.topic)}
            >
              <span className="pm-chip-row">
                <span className="pm-chip-name">{t.topic}</span>
                <span className="mono pm-chip-n">{plural(t.n, 'fact')}</span>
              </span>
              <span className="hbar" aria-hidden="true">
                <span style={{ width: `${Math.round((t.n / max) * 100)}%` }} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export const MEMORY_EMPTY = {
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
}
